/**
 * N8N Agent MCP Server
 * 
 * Exposes workflow building tools to AI IDEs via Model Context Protocol.
 * This server bridges IDE agents to the core workflow builder.
 * 
 * Follows the same strict schema-driven principles as n8n_agent_tool.js
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
// Configuration (loaded from electron-store or env)
interface N8nConfig {
    type: 'selfhosted' | 'cloud';
    url: string;
    authType: 'apikey' | 'basic' | 'none';
    apiKey?: string;
    username?: string;
    password?: string;
    cloudInstance?: string;
    cloudApiKey?: string;
}

function extractConnectionTypesFromIoSpec(spec: any): { types: string[]; slots: { type: string; maxConnections?: number }[] } {
    const slots: { type: string; maxConnections?: number }[] = [];
    const pushSlot = (type: unknown, maxConnections?: unknown) => {
        const t = String(type || '').trim();
        if (!t) return;
        const mc = typeof maxConnections === 'number' ? maxConnections : undefined;
        slots.push({ type: t, maxConnections: mc });
    };

    if (Array.isArray(spec)) {
        for (const entry of spec) {
            if (typeof entry === 'string') pushSlot(entry);
            else if (entry && typeof entry === 'object') pushSlot((entry as any).type, (entry as any).maxConnections);
        }
        return { types: Array.from(new Set(slots.map((s) => s.type))), slots };
    }

    if (typeof spec === 'string') {
        const re = /type\s*:\s*['\"]([^'\"]+)['\"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(spec))) {
            pushSlot(m[1]);
        }
        const types = Array.from(new Set(slots.map((s) => s.type)));
        return { types, slots };
    }

    if (typeof spec === 'object' && spec) {
        pushSlot((spec as any).type, (spec as any).maxConnections);
        return { types: Array.from(new Set(slots.map((s) => s.type))), slots };
    }

    return { types: [], slots: [] };
}

function getNodeByName(state: any, nodeName: string): any | null {
    return (state?.nodes || []).find((n: any) => n?.name === nodeName) || null;
}

function getSchemaDefForNode(state: any, nodeName: string): any | null {
    const node = getNodeByName(state, nodeName);
    if (!node?.type) return null;
    return getNodeSchema().find((s: any) => s?.name === node.type) || null;
}

function getIncomingCount(connections: Record<string, any>, targetNode: string, inputType: string, inputIndex: number): number {
    let count = 0;
    for (const [source, byOutput] of Object.entries(connections || {})) {
        if (!byOutput || typeof byOutput !== 'object') continue;
        for (const outputs of Object.values(byOutput as any)) {
            if (!Array.isArray(outputs)) continue;
            for (const arr of outputs) {
                if (!Array.isArray(arr)) continue;
                for (const c of arr) {
                    if (c?.node === targetNode && c?.type === inputType && Number(c?.index) === Number(inputIndex)) {
                        count++;
                    }
                }
            }
        }
    }
    return count;
}

function ensureConnectionArray(state: any, from: string, outputType: string, outputIndex: number): void {
    if (!state.connections) state.connections = {};
    if (!state.connections[from]) state.connections[from] = {};
    if (!state.connections[from][outputType]) state.connections[from][outputType] = [];
    while (state.connections[from][outputType].length <= outputIndex) {
        state.connections[from][outputType].push([]);
    }
}

function pickAiSubnodeType(fromDef: any, toDef: any, requestedType?: string): { inputType: string; outputType: string } | null {
    const desired = String(requestedType || '').trim();
    const fromOutputs = extractConnectionTypesFromIoSpec(fromDef?.outputs).types;
    const toInputs = extractConnectionTypesFromIoSpec(toDef?.inputs).types;

    const usableAsTool = !!fromDef?.usableAsTool;

    const tryPick = (inputType: string): { inputType: string; outputType: string } | null => {
        if (inputType === 'ai_tool' && usableAsTool && fromOutputs.includes('main') && toInputs.includes('ai_tool')) {
            return { inputType: 'ai_tool', outputType: 'main' };
        }
        if (fromOutputs.includes(inputType) && toInputs.includes(inputType)) {
            return { inputType, outputType: inputType };
        }
        return null;
    };

    if (desired) {
        return tryPick(desired);
    }

    const priority = ['ai_languageModel', 'ai_tool', 'ai_memory', 'ai_outputParser'];
    for (const t of priority) {
        const picked = tryPick(t);
        if (picked) return picked;
    }
    return null;
}

function pickInputIndex(state: any, to: string, toDef: any, inputType: string, requestedIndex?: number): number {
    if (typeof requestedIndex === 'number' && requestedIndex >= 0) return Math.floor(requestedIndex);
    if (inputType === 'ai_tool') return 0;

    const { slots } = extractConnectionTypesFromIoSpec(toDef?.inputs);
    const slotIndices = slots
        .map((s, idx) => ({ s, idx }))
        .filter((x) => x.s.type === inputType)
        .map((x) => x.idx);

    if (slotIndices.length === 0) return 0;

    for (const idx of slotIndices) {
        const existing = getIncomingCount(state.connections, to, inputType, idx);
        const maxConnections = slots[idx]?.maxConnections;
        if (typeof maxConnections === 'number') {
            if (maxConnections < 0) return idx;
            if (existing < maxConnections) return idx;
        } else {
            // If unspecified, allow multiple connections
            return idx;
        }
    }
    return slotIndices[0];
}

function isAiType(t: unknown): boolean {
    const s = String(t || '').trim();
    return s.startsWith('ai_');
}

function isValidTypedConnection(srcDef: any, dstDef: any, outputType: string, inputType: string): boolean {
    const srcOutputs = extractConnectionTypesFromIoSpec(srcDef?.outputs).types;
    const dstInputs = extractConnectionTypesFromIoSpec(dstDef?.inputs).types;
    const outOk = srcOutputs.includes(outputType);
    const inOk = dstInputs.includes(inputType);
    if (!outOk || !inOk) return false;
    if (outputType === inputType) return true;
    if (outputType === 'main' && inputType === 'ai_tool' && !!srcDef?.usableAsTool) return true;
    return false;
}

// State file for workflow building - use fixed absolute path for persistence
const STATE_FILE = path.join(__dirname, '..', '.agent_tool_state.json');
const SCHEMA_FILE = path.join(__dirname, '..', '..', 'rust-core', 'node-types-schema.json');

// Lazy-load schema on first use to avoid blocking startup
let _nodeSchema: any[] | null = null;
function getNodeSchema(): any[] {
    if (_nodeSchema === null) {
        console.error('[MCP] Loading node schema on first use...');
        try {
            if (fs.existsSync(SCHEMA_FILE)) {
                const data = JSON.parse(fs.readFileSync(SCHEMA_FILE, 'utf8'));
                _nodeSchema = Array.isArray(data) ? data : [];
                console.error(`[MCP] Loaded ${_nodeSchema.length} node types`);
            } else {
                console.error('[MCP] Schema file not found, using empty schema');
                _nodeSchema = [];
            }
        } catch (e) {
            console.error('[MCP] Failed to load schema:', e);
            _nodeSchema = [];
        }
    }
    return _nodeSchema || [];
}

// ===== Schema-driven helpers (aligned with n8n_agent_tool.js) =====
function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getAllowedTypeVersions(nodeSchema: any): number[] {
    if (!nodeSchema) return [];
    const versions: number[] = [];
    if (Array.isArray(nodeSchema.version)) {
        for (const v of nodeSchema.version) {
            if (typeof v === 'number') versions.push(v);
        }
    } else if (typeof nodeSchema.version === 'number') {
        versions.push(nodeSchema.version);
    }
    if (typeof nodeSchema.defaultVersion === 'number') versions.push(nodeSchema.defaultVersion);
    return Array.from(new Set(versions));
}

function resolveTypeVersion(nodeSchema: any, requestedTypeVersion?: number): number {
    const versions = getAllowedTypeVersions(nodeSchema);
    if (typeof requestedTypeVersion === 'number') {
        if (versions.length === 0) return Math.floor(requestedTypeVersion);
        if (versions.includes(requestedTypeVersion)) return Math.floor(requestedTypeVersion);
        return Math.floor(Math.max(...versions));
    }
    if (typeof nodeSchema?.defaultVersion === 'number') return Math.floor(nodeSchema.defaultVersion);
    if (versions.length > 0) return Math.floor(Math.max(...versions));
    return 1;
}

function normalizeDisplayOptionKey(key: string): string {
    const k = String(key || '').trim();
    if (!k) return '';
    if (k === '@version') return '@version';
    if (k.startsWith('/')) return k.slice(1).replace(/\//g, '.');
    return k;
}

function matchesVersionCondition(entry: any, typeVersion: number): boolean {
    if (typeof typeVersion !== 'number') return false;
    if (typeof entry === 'number') return typeVersion === entry;
    if (typeof entry === 'string') {
        const parsed = Number(entry);
        return !Number.isNaN(parsed) && typeVersion === parsed;
    }
    if (entry && typeof entry === 'object') {
        const cnd = (entry as any)._cnd;
        if (!cnd || typeof cnd !== 'object') return false;
        const ops = ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'] as const;
        for (const op of ops) {
            if ((cnd as any)[op] === undefined) continue;
            const v = Number((cnd as any)[op]);
            if (Number.isNaN(v)) return false;
            if (op === 'gte' && !(typeVersion >= v)) return false;
            if (op === 'lte' && !(typeVersion <= v)) return false;
            if (op === 'gt' && !(typeVersion > v)) return false;
            if (op === 'lt' && !(typeVersion < v)) return false;
            if (op === 'eq' && !(typeVersion === v)) return false;
            if (op === 'ne' && !(typeVersion !== v)) return false;
        }
        return true;
    }
    return false;
}

function getNestedValue(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    const parts = String(path).split('.').filter(Boolean);
    let current: any = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
}

function isPropertyVisible(propSchema: any, parameters: Record<string, any>, typeVersion: number): boolean {
    const displayOptions = propSchema?.displayOptions;
    if (!displayOptions) return true;
    const evalConfig = { ...(parameters || {}), '@version': typeVersion } as Record<string, any>;
    const check = (rules: Record<string, any> | undefined, mode: 'show' | 'hide') => {
        if (!rules) return true;
        for (const [rawKey, allowed] of Object.entries(rules)) {
            const key = normalizeDisplayOptionKey(rawKey);
            if (!key) continue;
            const allowedArr = Array.isArray(allowed) ? allowed : [allowed];
            if (key === '@version') {
                const ok = allowedArr.some((entry) => matchesVersionCondition(entry, typeVersion));
                if (mode === 'show' && !ok) return false;
                if (mode === 'hide' && ok) return false;
                continue;
            }
            const actual = getNestedValue(evalConfig, key);
            const matches = allowedArr.some((v) => v === actual);
            if (mode === 'show' && !matches) return false;
            if (mode === 'hide' && matches) return false;
        }
        return true;
    };
    if (!check(displayOptions.show, 'show')) return false;
    if (!check(displayOptions.hide, 'hide')) return false;
    return true;
}

function sanitizeParameters(nodeSchema: any, parameters: Record<string, any>, typeVersion: number): Record<string, any> {
    const schemaProps: any[] = Array.isArray(nodeSchema?.properties) ? nodeSchema.properties : [];
    const propByName = new Map(schemaProps.map((p: any) => [p.name, p]));
    const out: Record<string, any> = { ...(parameters || {}) };

    // Strip unknown fields
    for (const key of Object.keys(out)) {
        if (!propByName.has(key)) {
            delete out[key];
        }
    }

    // Strip parameters not visible for this configuration
    for (const key of Object.keys(out)) {
        const propSchema = propByName.get(key);
        if (!propSchema) continue;
        if (!isPropertyVisible(propSchema, out, typeVersion)) delete out[key];
    }

    // Fix structural shapes
    for (const propSchema of schemaProps) {
        const name = propSchema.name;
        if (!(name in out)) continue;
        if (!isPropertyVisible(propSchema, out, typeVersion)) continue;
        const t = String(propSchema.type || '').toLowerCase();
        const v = out[name];
        if ((t === 'collection' || t === 'fixedcollection') && v !== undefined && v !== null && !isPlainObject(v)) {
            out[name] = {};
        }
        if (t === 'multioptions' && v !== undefined && v !== null && !Array.isArray(v)) {
            out[name] = [v];
        }
        if (t === 'options' && Array.isArray(v)) {
            out[name] = v.length > 0 ? v[0] : undefined;
        }
    }

    // Fill required fields with defaults
    for (const propSchema of schemaProps) {
        const name = propSchema.name;
        const visible = isPropertyVisible(propSchema, out, typeVersion);
        if (!visible) continue;
        if (!propSchema.required) continue;
        if (out[name] !== undefined) continue;
        if (propSchema.default !== undefined) {
            out[name] = propSchema.default;
            continue;
        }
        const t = String(propSchema.type || '').toLowerCase();
        if (t === 'collection' || t === 'fixedcollection') out[name] = {};
        if (t === 'multioptions') out[name] = [];
    }

    return out;
}

// Load/save workflow state (matches n8n_agent_tool.js pattern)
// Enhanced to support multiple workflows with named slots
interface WorkflowState {
    nodes: any[];
    connections: Record<string, any>;
    metadata?: {
        workflowId?: string;
        workflowName?: string;
        lastModified?: string;
    };
}

interface MultiWorkflowState {
    current: string; // Name of the currently active workflow slot
    workflows: Record<string, WorkflowState>; // Named workflow slots
}

const MULTI_STATE_FILE = path.join(__dirname, '..', '.agent_multi_workflow_state.json');

function loadMultiState(): MultiWorkflowState {
    if (fs.existsSync(MULTI_STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(MULTI_STATE_FILE, 'utf8'));
        } catch {
            return { current: 'default', workflows: { default: { nodes: [], connections: {} } } };
        }
    }
    return { current: 'default', workflows: { default: { nodes: [], connections: {} } } };
}

function saveMultiState(state: MultiWorkflowState): void {
    try {
        fs.writeFileSync(MULTI_STATE_FILE, JSON.stringify(state, null, 2));
        console.error(`[MCP] Multi-workflow state saved`);
    } catch (e) {
        console.error(`[MCP] Failed to save multi-workflow state: ${e}`);
    }
}

// Legacy single-workflow state functions (for backward compatibility)
function loadState(): WorkflowState {
    const multiState = loadMultiState();
    return multiState.workflows[multiState.current] || { nodes: [], connections: {} };
}

function saveState(state: WorkflowState): void {
    const multiState = loadMultiState();
    multiState.workflows[multiState.current] = {
        ...state,
        metadata: {
            ...state.metadata,
            lastModified: new Date().toISOString()
        }
    };
    saveMultiState(multiState);

    // Also save to legacy file for backward compatibility
    try {
        fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        console.error(`[MCP] State saved to: ${STATE_FILE}`);
    } catch (e) {
        console.error(`[MCP] Failed to save state: ${e}`);
    }
}

// Get middleware URL from environment
const MIDDLEWARE_URL = process.env.MIDDLEWARE_URL || 'http://localhost:3456';

/**
 * Make request to the middleware API
 * The middleware handles authentication and forwards to n8n
 * Handles connection errors gracefully for resilience
 */
async function middlewareRequest(tool: string, args: Record<string, any> = {}): Promise<any> {
    const url = new URL(`/api/n8n/${tool}`, MIDDLEWARE_URL);

    return new Promise((resolve) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000, // 30 second timeout
        };

        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', (err: any) => {
            // Handle connection errors gracefully - don't crash, return error object
            if (err.code === 'ECONNREFUSED') {
                resolve({ error: `Middleware not running at ${MIDDLEWARE_URL}. Please start the N8N Agent Middleware app.` });
            } else {
                resolve({ error: `Connection error: ${err.message}` });
            }
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: 'Request timeout - middleware not responding' });
        });

        req.write(JSON.stringify(args));
        req.end();
    });
}

async function mcpRequest(tool: string, args: Record<string, any> = {}): Promise<any> {
    const url = new URL(`/api/mcp/${tool}`, MIDDLEWARE_URL);

    return new Promise((resolve) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        };

        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED') {
                resolve({ error: `Middleware not running at ${MIDDLEWARE_URL}. Please start the N8N Agent Middleware app.` });
            } else {
                resolve({ error: `Connection error: ${err.message}` });
            }
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: 'Request timeout - middleware not responding' });
        });

        req.write(JSON.stringify(args));
        req.end();
    });
}

async function browserRequest(action: string, args: Record<string, any> = {}): Promise<any> {
    const url = new URL('/api/browser/action', MIDDLEWARE_URL);

    return new Promise((resolve) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        };

        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED') {
                resolve({ error: `Middleware not running at ${MIDDLEWARE_URL}. Please start the N8N Agent Middleware app.` });
            } else {
                resolve({ error: `Connection error: ${err.message}` });
            }
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: 'Request timeout - middleware not responding' });
        });

        req.write(JSON.stringify({ ...args, action }));
        req.end();
    });
}

async function middlewareGet(apiPath: string): Promise<any> {
    const path = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
    const url = new URL(`/api${path}`, MIDDLEWARE_URL);

    return new Promise((resolve) => {
        const protocol = url.protocol === 'https:' ? https : http;
        const options = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname,
            method: 'GET',
            timeout: 30000,
        };

        const req = protocol.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', (err: any) => {
            if (err.code === 'ECONNREFUSED') {
                resolve({ error: `Middleware not running at ${MIDDLEWARE_URL}. Please start the N8N Agent Middleware app.` });
            } else {
                resolve({ error: `Connection error: ${err.message}` });
            }
        });

        req.on('timeout', () => {
            req.destroy();
            resolve({ error: 'Request timeout - middleware not responding' });
        });

        req.end();
    });
}

// Tool definitions exposed to IDEs
const TOOLS = [
    // ===== Workflow Building Tools (matches n8n_agent_tool.js) =====
    {
        name: 'n8n_init_workflow',
        description: 'Initialize a new empty workflow. Call this before adding nodes.',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_add_nodes_batch',
        description: 'Add multiple nodes to the workflow in a single call. Pass an array of node definitions.',
        inputSchema: {
            type: 'object',
            properties: {
                nodes: {
                    type: 'array',
                    description: 'Array of node definitions',
                    items: {
                        type: 'object',
                        properties: {
                            nodeType: { type: 'string', description: 'n8n node type (e.g., n8n-nodes-base.webhook)' },
                            name: { type: 'string', description: 'Display name for the node' },
                            parameters: { type: 'object', description: 'Node configuration parameters' },
                            x: { type: 'number', description: 'X position (default 0)' },
                            y: { type: 'number', description: 'Y position (default 0)' },
                        },
                        required: ['nodeType', 'name'],
                    },
                },
            },
            required: ['nodes'],
        },
    },
    {
        name: 'n8n_connect_nodes_batch',
        description: 'Connect multiple node pairs in a single call. Pass an array of connections.',
        inputSchema: {
            type: 'object',
            properties: {
                connections: {
                    type: 'array',
                    description: 'Array of connection definitions',
                    items: {
                        type: 'object',
                        properties: {
                            from: { type: 'string', description: 'Source node name' },
                            to: { type: 'string', description: 'Target node name' },
                            outputIndex: { type: 'number', description: 'Output index (default 0)' },
                            inputIndex: { type: 'number', description: 'Input index (default 0)' },
                            outputType: { type: 'string', description: 'Output type (default "main")' },
                            inputType: { type: 'string', description: 'Input type (default "main")' },
                        },
                        required: ['from', 'to'],
                    },
                },
            },
            required: ['connections'],
        },
    },
    {
        name: 'n8n_connect_subnode',
        description: 'Connect a sub-node (e.g. AI Model or Tool) to a parent node (e.g. AI Agent). Simplifies connecting to named inputs like ai_languageModel.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Source node name (the sub-node)' },
                to: { type: 'string', description: 'Target node name (the parent agent/chain)' },
                type: { type: 'string', description: 'Optional connection type override (e.g. "ai_languageModel", "ai_tool", "ai_memory"). If omitted, inferred from node schema.' },
                outputIndex: { type: 'number', description: 'Output index (default 0)' },
                inputIndex: { type: 'number', description: 'Optional input slot index on the target. If omitted, the server picks a valid slot (and respects maxConnections when available).' },
            },
            required: ['from', 'to'],
        },
    },
    {
        name: 'n8n_configure_nodes_batch',
        description: 'Update parameters on multiple nodes in a single call.',
        inputSchema: {
            type: 'object',
            properties: {
                configurations: {
                    type: 'array',
                    description: 'Array of node configurations',
                    items: {
                        type: 'object',
                        properties: {
                            nodeName: { type: 'string', description: 'Name of the node to configure' },
                            parameters: { type: 'object', description: 'Parameters to update' },
                        },
                        required: ['nodeName', 'parameters'],
                    },
                },
            },
            required: ['configurations'],
        },
    },
    {
        name: 'n8n_remove_node',
        description: 'Remove a single node from the current workflow and clean up its connections.',
        inputSchema: {
            type: 'object',
            properties: {
                nodeName: { type: 'string', description: 'Name of the node to remove' },
            },
            required: ['nodeName'],
        },
    },
    {
        name: 'n8n_remove_nodes_batch',
        description: 'Remove multiple nodes from the current workflow in a single call.',
        inputSchema: {
            type: 'object',
            properties: {
                nodeNames: {
                    type: 'array',
                    description: 'Array of node names to remove',
                    items: { type: 'string' },
                },
            },
            required: ['nodeNames'],
        },
    },
    {
        name: 'n8n_disconnect_nodes',
        description: 'Disconnect two nodes without removing them. Removes the connection between source and target.',
        inputSchema: {
            type: 'object',
            properties: {
                from: { type: 'string', description: 'Source node name' },
                to: { type: 'string', description: 'Target node name' },
                outputIndex: { type: 'number', description: 'Output index (default 0)' },
                inputIndex: { type: 'number', description: 'Input index (default 0)' },
            },
            required: ['from', 'to'],
        },
    },
    {
        name: 'n8n_disconnect_all_from_node',
        description: 'Disconnect all connections from/to a specific node without removing the node itself.',
        inputSchema: {
            type: 'object',
            properties: {
                nodeName: { type: 'string', description: 'Node name to disconnect' },
            },
            required: ['nodeName'],
        },
    },
    {
        name: 'n8n_save_workflow',
        description: 'Save the workflow to a JSON file',
        inputSchema: {
            type: 'object',
            properties: {
                filename: { type: 'string', description: 'Output filename' },
                name: { type: 'string', description: 'Workflow display name' },
            },
            required: ['filename'],
        },
    },
    {
        name: 'n8n_list_nodes',
        description: 'List all nodes in the current workflow',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_get_schema',
        description: 'Get schema/properties for a node type',
        inputSchema: {
            type: 'object',
            properties: {
                nodeType: { type: 'string', description: 'Node type to inspect' },
                property: { type: 'string', description: 'Specific property to get options for' },
            },
            required: ['nodeType'],
        },
    },
    {
        name: 'n8n_get_schema_detail',
        description: 'Get details for a node type and optional property (CLI parity with builder get-schema-detail)',
        inputSchema: {
            type: 'object',
            properties: {
                nodeType: { type: 'string', description: 'Node type name' },
                property: { type: 'string', description: 'Optional property name' },
            },
            required: ['nodeType'],
        },
    },

    // ===== BROWSER AUTOMATION (GHOST PILOT) =====
    {
        name: 'browser_click',
        description: 'Click an element in the n8n interface (Visual Agent)',
        inputSchema: {
            type: 'object',
            properties: {
                selector: { type: 'string', description: 'CSS selector to click' },
                x: { type: 'number', description: 'X coordinate' },
                y: { type: 'number', description: 'Y coordinate' },
            },
            required: [],
        },
    },
    {
        name: 'browser_type',
        description: 'Type text into the focused element (Visual Agent)',
        inputSchema: {
            type: 'object',
            properties: {
                text: { type: 'string', description: 'Text to type' },
            },
            required: ['text'],
        },
    },
    {
        name: 'browser_screenshot',
        description: 'Capture screenshot of n8n interface (Visual Agent)',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'browser_eval',
        description: 'Evaluate JavaScript in the n8n browser context (Visual Agent)',
        inputSchema: {
            type: 'object',
            properties: {
                expression: { type: 'string', description: 'JS expression' },
            },
            required: ['expression'],
        },
    },

    // ===== WORKFLOW API =====
    {
        name: 'n8n_workflow_list',
        description: 'List all workflows from the n8n instance',
        inputSchema: {
            type: 'object',
            properties: {
                active: { type: 'boolean', description: 'Filter by active status' },
                tags: { type: 'string', description: 'Filter by tag IDs (comma-separated)' },
            },
            required: []
        },
    },
    {
        name: 'n8n_workflow_read',
        description: 'Get a specific workflow by ID',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_load_workflow_to_state',
        description: 'Load a published workflow from n8n into the local state for editing. This fetches the workflow and populates the current workflow slot.',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID to load' },
                slotName: { type: 'string', description: 'Optional: Name of the workflow slot to load into (default: current slot)' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_switch_workflow_slot',
        description: 'Switch to a different workflow slot. This allows working on multiple workflows simultaneously.',
        inputSchema: {
            type: 'object',
            properties: {
                slotName: { type: 'string', description: 'Name of the workflow slot to switch to (creates if doesn\'t exist)' },
            },
            required: ['slotName'],
        },
    },
    {
        name: 'n8n_list_workflow_slots',
        description: 'List all workflow slots and show which one is currently active.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'n8n_workflow_create',
        description: 'Create a new workflow on the n8n instance',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Workflow name' },
                nodes: { type: 'array', description: 'Array of nodes (uses current state if omitted)' },
                connections: { type: 'object', description: 'Connection map (uses current state if omitted)' },
            },
            required: ['name'],
        },
    },
    {
        name: 'n8n_workflow_update',
        description: 'Update an existing workflow',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                name: { type: 'string', description: 'New name' },
                nodes: { type: 'array', description: 'New nodes array' },
                connections: { type: 'object', description: 'New connections' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_create_workflow_from_state',
        description: 'Create an n8n workflow from the current in-memory builder state (CLI parity with builder create-from-state)',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Optional workflow name' },
            },
            required: [],
        },
    },
    {
        name: 'n8n_workflow_update_from_state',
        description: 'Update an existing n8n workflow from the current/selected in-memory builder state (CLI parity with builder update-remote)',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                slotName: { type: 'string', description: 'Optional state slot name (defaults to current)' },
                name: { type: 'string', description: 'Optional override workflow name in n8n' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_workflow_delete',
        description: 'Delete a workflow',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID to delete' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_workflow_activate',
        description: 'Activate a workflow',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_workflow_deactivate',
        description: 'Deactivate a workflow',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_workflow_move',
        description: 'Move workflow to a different project',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                destinationProjectId: { type: 'string', description: 'Target project ID' },
            },
            required: ['workflowId', 'destinationProjectId'],
        },
    },

    // ===== EXECUTION API =====
    {
        name: 'n8n_execution_list',
        description: 'List workflow executions',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Filter by workflow ID' },
                status: { type: 'string', description: 'Filter by status (success, error, waiting)' },
                limit: { type: 'number', description: 'Max results (default 20)' },
            },
            required: [],
        },
    },
    {
        name: 'n8n_execution_read',
        description: 'Get details of a specific execution',
        inputSchema: {
            type: 'object',
            properties: {
                executionId: { type: 'string', description: 'Execution ID' },
            },
            required: ['executionId'],
        },
    },
    {
        name: 'n8n_execution_delete',
        description: 'Delete an execution',
        inputSchema: {
            type: 'object',
            properties: {
                executionId: { type: 'string', description: 'Execution ID to delete' },
            },
            required: ['executionId'],
        },
    },
    {
        name: 'n8n_execution_retry',
        description: 'Retry a failed execution',
        inputSchema: {
            type: 'object',
            properties: {
                executionId: { type: 'string', description: 'Execution ID to retry' },
            },
            required: ['executionId'],
        },
    },

    // ===== CREDENTIAL API =====
    {
        name: 'n8n_credential_list',
        description: 'List all credentials',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_credential_create',
        description: 'Create a new credential',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Credential name' },
                type: { type: 'string', description: 'Credential type (e.g., slackApi, httpBasicAuth)' },
                data: { type: 'object', description: 'Credential data (API keys, tokens, etc.)' },
            },
            required: ['name', 'type', 'data'],
        },
    },
    {
        name: 'n8n_credential_delete',
        description: 'Delete a credential',
        inputSchema: {
            type: 'object',
            properties: {
                credentialId: { type: 'string', description: 'Credential ID to delete' },
            },
            required: ['credentialId'],
        },
    },
    {
        name: 'n8n_credential_move',
        description: 'Move credential to a different project',
        inputSchema: {
            type: 'object',
            properties: {
                credentialId: { type: 'string', description: 'Credential ID' },
                destinationProjectId: { type: 'string', description: 'Target project ID' },
            },
            required: ['credentialId', 'destinationProjectId'],
        },
    },

    // ===== TAG API =====
    {
        name: 'n8n_tag_list',
        description: 'List all tags',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_tag_read',
        description: 'Get a tag by ID',
        inputSchema: {
            type: 'object',
            properties: {
                tagId: { type: 'string', description: 'Tag ID' },
            },
            required: ['tagId'],
        },
    },
    {
        name: 'n8n_tag_create',
        description: 'Create a new tag',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Tag name' },
            },
            required: ['name'],
        },
    },
    {
        name: 'n8n_tag_update',
        description: 'Update a tag',
        inputSchema: {
            type: 'object',
            properties: {
                tagId: { type: 'string', description: 'Tag ID' },
                name: { type: 'string', description: 'New tag name' },
            },
            required: ['tagId', 'name'],
        },
    },
    {
        name: 'n8n_tag_delete',
        description: 'Delete a tag',
        inputSchema: {
            type: 'object',
            properties: {
                tagId: { type: 'string', description: 'Tag ID to delete' },
            },
            required: ['tagId'],
        },
    },

    // ===== WORKFLOW TAGS API =====
    {
        name: 'n8n_workflowtags_list',
        description: 'List tags for a workflow',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_workflowtags_update',
        description: 'Update tags for a workflow',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                tagIds: { type: 'array', description: 'Array of tag IDs to assign' },
            },
            required: ['workflowId', 'tagIds'],
        },
    },

    // ===== VARIABLE API =====
    {
        name: 'n8n_variable_list',
        description: 'List all variables',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_variable_create',
        description: 'Create a new variable',
        inputSchema: {
            type: 'object',
            properties: {
                key: { type: 'string', description: 'Variable key' },
                value: { type: 'string', description: 'Variable value' },
            },
            required: ['key', 'value'],
        },
    },
    {
        name: 'n8n_variable_update',
        description: 'Update a variable',
        inputSchema: {
            type: 'object',
            properties: {
                variableId: { type: 'string', description: 'Variable ID' },
                key: { type: 'string', description: 'New key' },
                value: { type: 'string', description: 'New value' },
            },
            required: ['variableId'],
        },
    },
    {
        name: 'n8n_variable_delete',
        description: 'Delete a variable',
        inputSchema: {
            type: 'object',
            properties: {
                variableId: { type: 'string', description: 'Variable ID to delete' },
            },
            required: ['variableId'],
        },
    },

    // ===== USER API =====
    {
        name: 'n8n_user_list',
        description: 'List all users',
        inputSchema: {
            type: 'object',
            properties: {
                includeRole: { type: 'boolean', description: 'Include role information' },
            },
            required: []
        },
    },
    {
        name: 'n8n_user_read',
        description: 'Get user by ID',
        inputSchema: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'User ID' },
            },
            required: ['userId'],
        },
    },
    {
        name: 'n8n_user_create',
        description: 'Create a new user',
        inputSchema: {
            type: 'object',
            properties: {
                email: { type: 'string', description: 'User email' },
                firstName: { type: 'string', description: 'First name' },
                lastName: { type: 'string', description: 'Last name' },
                role: { type: 'string', description: 'Role (global:admin, global:member)' },
            },
            required: ['email'],
        },
    },
    {
        name: 'n8n_user_delete',
        description: 'Delete a user',
        inputSchema: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'User ID to delete' },
            },
            required: ['userId'],
        },
    },
    {
        name: 'n8n_user_changeRole',
        description: 'Change user role',
        inputSchema: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'User ID' },
                role: { type: 'string', description: 'New role (global:admin, global:member)' },
            },
            required: ['userId', 'role'],
        },
    },
    {
        name: 'n8n_user_enforceMfa',
        description: 'Enforce MFA for a user',
        inputSchema: {
            type: 'object',
            properties: {
                userId: { type: 'string', description: 'User ID' },
                enabled: { type: 'boolean', description: 'Enable/disable MFA requirement' },
            },
            required: ['userId', 'enabled'],
        },
    },

    // ===== PROJECT API =====
    {
        name: 'n8n_project_list',
        description: 'List all projects',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_project_create',
        description: 'Create a new project',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Project name' },
            },
            required: ['name'],
        },
    },
    {
        name: 'n8n_project_update',
        description: 'Update a project',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'Project ID' },
                name: { type: 'string', description: 'New project name' },
            },
            required: ['projectId', 'name'],
        },
    },
    {
        name: 'n8n_project_delete',
        description: 'Delete a project',
        inputSchema: {
            type: 'object',
            properties: {
                projectId: { type: 'string', description: 'Project ID to delete' },
            },
            required: ['projectId'],
        },
    },

    // ===== SOURCE CONTROL API =====
    {
        name: 'n8n_sourcecontrol_pull',
        description: 'Pull changes from source control',
        inputSchema: {
            type: 'object',
            properties: {
                force: { type: 'boolean', description: 'Force pull (overwrite local changes)' },
            },
            required: [],
        },
    },

    // ===== SECURITY AUDIT API =====
    {
        name: 'n8n_securityaudit_generate',
        description: 'Generate a security audit report',
        inputSchema: {
            type: 'object',
            properties: {
                categories: { type: 'array', description: 'Audit categories (credentials, nodes, instance)' },
            },
            required: [],
        },
    },

    // ===== UTILITY =====
    {
        name: 'n8n_test_connection',
        description: 'Test connection to the configured n8n instance',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_health',
        description: 'Check middleware health (CLI parity with n8n-cli health)',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_config',
        description: 'Get current middleware configuration (CLI parity with n8n-cli config)',
        inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
        name: 'n8n_execute_workflow',
        description: 'Execute a workflow manually',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                data: { type: 'object', description: 'Input data for the workflow' },
            },
            required: ['workflowId'],
        },
    },
    {
        name: 'n8n_diagnose_workflow',
        description: 'Run a workflow and return detailed diagnostics (polls until finished, fetches execution with includeData=true)',
        inputSchema: {
            type: 'object',
            properties: {
                workflowId: { type: 'string', description: 'Workflow ID' },
                data: { type: 'object', description: 'Input data for the workflow' },
                wait: { type: 'boolean', description: 'Wait for execution to finish (poll)' },
                timeoutMs: { type: 'number', description: 'Max time to wait for completion (ms)' },
                pollIntervalMs: { type: 'number', description: 'Polling interval (ms)' },
                ensureSaveData: { type: 'boolean', description: 'Temporarily enable execution data saving settings for this workflow' },
                restoreSettings: { type: 'boolean', description: 'Restore original workflow settings after diagnostics' },
                includeExecution: { type: 'boolean', description: 'Include the raw execution object in the response' },
            },
            required: ['workflowId'],
        },
    },
];

/**
 * Handle tool calls from IDE agents
 */
async function handleToolCall(name: string, args: Record<string, any>): Promise<string> {
    const state = loadState();

    // License validation is handled by Electron app before starting MCP
    // No license check needed here - if MCP is running, user is licensed

    try {
        switch (name) {
            // ===== Workflow Building Tools =====
            case 'n8n_init_workflow':
                saveState({ nodes: [], connections: {} });
                return '✅ Workflow initialized';

            case 'n8n_add_nodes_batch': {
                const { nodes } = args;
                if (!nodes || !Array.isArray(nodes)) {
                    return '❌ nodes must be an array';
                }
                const added: string[] = [];
                const errors: string[] = [];

                for (const nodeSpec of nodes) {
                    const { nodeType, name: nodeName, parameters, x = 0, y = 0 } = nodeSpec;
                    const schema = getNodeSchema().find(n => n.name === nodeType);
                    if (!schema) {
                        errors.push(`Unknown node type: ${nodeType}`);
                        continue;
                    }
                    const node: any = {
                        parameters: parameters || {},
                        id: crypto.randomUUID(),
                        name: nodeName,
                        type: nodeType,
                        typeVersion: Math.floor(schema.defaultVersion || 1),
                        position: [x, y],
                    };
                    // Add webhookId for webhook nodes (required by n8n)
                    if (nodeType === 'n8n-nodes-base.webhook') {
                        node.webhookId = crypto.randomUUID().substring(0, 8);
                    }
                    state.nodes.push(node);
                    added.push(nodeName);
                }
                saveState(state);

                let result = `✅ Added ${added.length} nodes: ${added.join(', ')}`;
                if (errors.length > 0) {
                    result += `\n⚠️ Errors: ${errors.join('; ')}`;
                }
                return result;
            }

            case 'n8n_connect_nodes_batch': {
                const { connections } = args;
                if (!connections || !Array.isArray(connections)) {
                    return '❌ connections must be an array';
                }
                const connected: string[] = [];
                const errors: string[] = [];

                for (const conn of connections) {
                    const {
                        from,
                        to,
                        outputIndex = 0,
                        inputIndex,
                        outputType,
                        inputType,
                        type,
                    } = conn;

                    if (!getNodeByName(state, from)) {
                        errors.push(`Source not found: ${from}`);
                        continue;
                    }
                    if (!getNodeByName(state, to)) {
                        errors.push(`Target not found: ${to}`);
                        continue;
                    }

                    const fromDef = getSchemaDefForNode(state, from);
                    const toDef = getSchemaDefForNode(state, to);

                    const requestedOut = String(outputType ?? 'main');
                    const requestedIn = String(inputType ?? 'main');
                    const hasExplicitTypes =
                        (typeof outputType === 'string' && outputType.trim().length > 0) ||
                        (typeof inputType === 'string' && inputType.trim().length > 0) ||
                        (typeof type === 'string' && type.trim().length > 0);

                    // If schema isn't available, fall back to legacy behavior
                    if (!fromDef || !toDef) {
                        ensureConnectionArray(state, from, requestedOut, Math.floor(outputIndex));
                        state.connections[from][requestedOut][Math.floor(outputIndex)].push({
                            node: to,
                            type: requestedIn,
                            index: typeof inputIndex === 'number' ? Math.floor(inputIndex) : 0,
                        });
                        connected.push(`${from}->${to} (${requestedOut})`);
                        continue;
                    }

                    const shouldAttemptAiInference =
                        isAiType(type) ||
                        isAiType(requestedOut) ||
                        isAiType(requestedIn) ||
                        extractConnectionTypesFromIoSpec(fromDef.outputs).types.some(isAiType) ||
                        extractConnectionTypesFromIoSpec(toDef.inputs).types.some(isAiType);

                    // If the caller did not specify types, prefer schema-inferred AI connections
                    // (prevents accidentally creating main->main connections for subnodes)
                    if (shouldAttemptAiInference && !hasExplicitTypes) {
                        const pickedForward = pickAiSubnodeType(fromDef, toDef, undefined);
                        const pickedReverse = pickAiSubnodeType(toDef, fromDef, undefined);

                        let src = from;
                        let dst = to;
                        let picked = pickedForward;
                        let dstDef = toDef;
                        if (!picked && pickedReverse) {
                            src = to;
                            dst = from;
                            picked = pickedReverse;
                            dstDef = fromDef;
                        }

                        if (picked) {
                            const resolvedInputIndex = pickInputIndex(state, dst, dstDef, picked.inputType, inputIndex);
                            if (picked.inputType !== 'ai_tool') {
                                const { slots } = extractConnectionTypesFromIoSpec(dstDef?.inputs);
                                const maxConnections = slots?.[resolvedInputIndex]?.maxConnections;
                                if (typeof maxConnections === 'number' && maxConnections >= 0) {
                                    const existing = getIncomingCount(state.connections, dst, picked.inputType, resolvedInputIndex);
                                    if (existing >= maxConnections) {
                                        errors.push(`Target input slot is full: ${dst} ${picked.inputType}[${resolvedInputIndex}] max=${maxConnections}`);
                                        continue;
                                    }
                                }
                            }
                            ensureConnectionArray(state, src, picked.outputType, Math.floor(outputIndex));
                            state.connections[src][picked.outputType][Math.floor(outputIndex)].push({
                                node: dst,
                                type: picked.inputType,
                                index: resolvedInputIndex,
                            });
                            connected.push(`${src}->${dst} (${picked.outputType})`);
                            continue;
                        }
                        // fall through to allow main->main only if no AI wiring exists
                    }

                    // If the user-provided types are valid, accept them (but still enforce maxConnections for ai_*).
                    if (!shouldAttemptAiInference || (hasExplicitTypes && isValidTypedConnection(fromDef, toDef, requestedOut, requestedIn))) {
                        const resolvedInputIndex =
                            requestedIn === 'main'
                                ? (typeof inputIndex === 'number' ? Math.floor(inputIndex) : 0)
                                : pickInputIndex(state, to, toDef, requestedIn, inputIndex);

                        if (isAiType(requestedIn) && requestedIn !== 'ai_tool') {
                            const { slots } = extractConnectionTypesFromIoSpec(toDef?.inputs);
                            const maxConnections = slots?.[resolvedInputIndex]?.maxConnections;
                            if (typeof maxConnections === 'number' && maxConnections >= 0) {
                                const existing = getIncomingCount(state.connections, to, requestedIn, resolvedInputIndex);
                                if (existing >= maxConnections) {
                                    errors.push(`Target input slot is full: ${to} ${requestedIn}[${resolvedInputIndex}] max=${maxConnections}`);
                                    continue;
                                }
                            }
                        }

                        ensureConnectionArray(state, from, requestedOut, Math.floor(outputIndex));
                        state.connections[from][requestedOut][Math.floor(outputIndex)].push({
                            node: to,
                            type: requestedIn,
                            index: resolvedInputIndex,
                        });
                        connected.push(`${from}->${to} (${requestedOut})`);
                        continue;
                    }

                    // Try to infer a valid AI connection (including direction)
                    const requestedAiType = isAiType(type)
                        ? String(type)
                        : (isAiType(requestedIn) ? requestedIn : (isAiType(requestedOut) ? requestedOut : undefined));

                    const pickedForward = pickAiSubnodeType(fromDef, toDef, requestedAiType);
                    const pickedReverse = pickAiSubnodeType(toDef, fromDef, requestedAiType);

                    let src = from;
                    let dst = to;
                    let picked = pickedForward;
                    let srcDef = fromDef;
                    let dstDef = toDef;

                    if (!picked && pickedReverse) {
                        src = to;
                        dst = from;
                        picked = pickedReverse;
                        srcDef = toDef;
                        dstDef = fromDef;
                    }

                    if (!picked) {
                        const srcOutputs = extractConnectionTypesFromIoSpec(srcDef?.outputs).types.join(', ') || '(none)';
                        const dstInputs = extractConnectionTypesFromIoSpec(dstDef?.inputs).types.join(', ') || '(none)';
                        errors.push(`No valid inferred connection for ${from}->${to}. srcOutputs=[${srcOutputs}] dstInputs=[${dstInputs}] requestedOut=${requestedOut} requestedIn=${requestedIn}`);
                        continue;
                    }

                    const resolvedInputIndex = pickInputIndex(state, dst, dstDef, picked.inputType, inputIndex);
                    if (picked.inputType !== 'ai_tool') {
                        const { slots } = extractConnectionTypesFromIoSpec(dstDef?.inputs);
                        const maxConnections = slots?.[resolvedInputIndex]?.maxConnections;
                        if (typeof maxConnections === 'number' && maxConnections >= 0) {
                            const existing = getIncomingCount(state.connections, dst, picked.inputType, resolvedInputIndex);
                            if (existing >= maxConnections) {
                                errors.push(`Target input slot is full: ${dst} ${picked.inputType}[${resolvedInputIndex}] max=${maxConnections}`);
                                continue;
                            }
                        }
                    }

                    ensureConnectionArray(state, src, picked.outputType, Math.floor(outputIndex));
                    state.connections[src][picked.outputType][Math.floor(outputIndex)].push({
                        node: dst,
                        type: picked.inputType,
                        index: resolvedInputIndex,
                    });
                    connected.push(`${src}->${dst} (${picked.outputType})`);
                }
                saveState(state);

                let result = `✅ Connected ${connected.length} pairs`;
                if (errors.length > 0) {
                    result += `\n⚠️ Errors: ${errors.join('; ')}`;
                }
                return result;
            }

            case 'n8n_connect_subnode': {
                const { from, to, type, outputIndex = 0, inputIndex } = args;

                if (!getNodeByName(state, from)) return `❌ Source not found: ${from}`;
                if (!getNodeByName(state, to)) return `❌ Target not found: ${to}`;

                const fromDef = getSchemaDefForNode(state, from);
                const toDef = getSchemaDefForNode(state, to);
                if (!fromDef || !toDef) return '❌ Could not resolve node schema for one or more nodes';

                const pickedForward = pickAiSubnodeType(fromDef, toDef, type);
                const pickedReverse = pickAiSubnodeType(toDef, fromDef, type);

                let src = from;
                let dst = to;
                let picked = pickedForward;
                let srcDef = fromDef;
                let dstDef = toDef;

                if (!picked && pickedReverse) {
                    src = to;
                    dst = from;
                    picked = pickedReverse;
                    srcDef = toDef;
                    dstDef = fromDef;
                }

                if (!picked) {
                    const srcOutputs = extractConnectionTypesFromIoSpec(srcDef?.outputs).types.join(', ') || '(none)';
                    const dstInputs = extractConnectionTypesFromIoSpec(dstDef?.inputs).types.join(', ') || '(none)';
                    return `❌ No valid sub-node connection found. srcOutputs=[${srcOutputs}] dstInputs=[${dstInputs}] requestedType=${String(type || '')}`;
                }

                const resolvedInputIndex = pickInputIndex(state, dst, dstDef, picked.inputType, inputIndex);
                if (picked.inputType !== 'ai_tool') {
                    const { slots } = extractConnectionTypesFromIoSpec(dstDef?.inputs);
                    const maxConnections = slots?.[resolvedInputIndex]?.maxConnections;
                    if (typeof maxConnections === 'number' && maxConnections >= 0) {
                        const existing = getIncomingCount(state.connections, dst, picked.inputType, resolvedInputIndex);
                        if (existing >= maxConnections) {
                            return `❌ Target input slot is full: ${dst} ${picked.inputType}[${resolvedInputIndex}] max=${maxConnections}`;
                        }
                    }
                }

                ensureConnectionArray(state, src, picked.outputType, Math.floor(outputIndex));
                state.connections[src][picked.outputType][Math.floor(outputIndex)].push({
                    node: dst,
                    type: picked.inputType,
                    index: resolvedInputIndex,
                });
                saveState(state);

                const swapped = src !== from || dst !== to;
                const swapNote = swapped ? ' (auto-swapped direction)' : '';
                return `✅ Connected sub-node: ${src} -> ${dst} (output=${picked.outputType} input=${picked.inputType}[${resolvedInputIndex}])${swapNote}`;
            }

            case 'n8n_configure_nodes_batch': {
                const { configurations } = args;
                if (!configurations || !Array.isArray(configurations)) {
                    return '❌ configurations must be an array';
                }
                const configured: string[] = [];
                const errors: string[] = [];

                for (const config of configurations) {
                    const { nodeName, parameters } = config;
                    const node = state.nodes.find(n => n.name === nodeName);
                    if (!node) {
                        errors.push(`Node not found: ${nodeName}`);
                        continue;
                    }
                    node.parameters = { ...node.parameters, ...parameters };
                    configured.push(nodeName);
                }
                saveState(state);

                let result = `✅ Configured ${configured.length} nodes: ${configured.join(', ')}`;
                if (errors.length > 0) {
                    result += `\n⚠️ Errors: ${errors.join('; ')}`;
                }
                return result;
            }

            case 'n8n_remove_node': {
                const { nodeName } = args;
                if (!nodeName) {
                    return '❌ nodeName is required';
                }
                const nodeIndex = state.nodes.findIndex(n => n.name === nodeName);
                if (nodeIndex === -1) {
                    return `❌ Node not found: ${nodeName}`;
                }

                // Remove the node
                state.nodes.splice(nodeIndex, 1);

                // Clean up connections FROM this node
                delete state.connections[nodeName];

                // Clean up connections TO this node
                for (const sourceNode in state.connections) {
                    if (state.connections[sourceNode]?.main) {
                        state.connections[sourceNode].main = state.connections[sourceNode].main.map(
                            (outputs: any[]) => outputs.filter((conn: any) => conn.node !== nodeName)
                        );
                    }
                }

                saveState(state);
                return `✅ Removed node: ${nodeName}`;
            }

            case 'n8n_remove_nodes_batch': {
                const { nodeNames } = args;
                if (!nodeNames || !Array.isArray(nodeNames)) {
                    return '❌ nodeNames must be an array';
                }
                const removed: string[] = [];
                const errors: string[] = [];

                for (const nodeName of nodeNames) {
                    const nodeIndex = state.nodes.findIndex(n => n.name === nodeName);
                    if (nodeIndex === -1) {
                        errors.push(`Node not found: ${nodeName}`);
                        continue;
                    }

                    // Remove the node
                    state.nodes.splice(nodeIndex, 1);

                    // Clean up connections FROM this node
                    delete state.connections[nodeName];

                    // Clean up connections TO this node
                    for (const sourceNode in state.connections) {
                        if (state.connections[sourceNode]?.main) {
                            state.connections[sourceNode].main = state.connections[sourceNode].main.map(
                                (outputs: any[]) => outputs.filter((conn: any) => conn.node !== nodeName)
                            );
                        }
                    }

                    removed.push(nodeName);
                }

                saveState(state);
                let result = `✅ Removed ${removed.length} nodes: ${removed.join(', ')}`;
                if (errors.length > 0) {
                    result += `\n⚠️ Errors: ${errors.join('; ')}`;
                }
                return result;
            }

            case 'n8n_disconnect_nodes': {
                const { from, to, outputIndex = 0, inputIndex = 0 } = args;
                if (!from || !to) {
                    return '❌ from and to are required';
                }

                // Check if connection exists
                if (!state.connections[from]?.main?.[outputIndex]) {
                    return `❌ No connections from ${from} at output ${outputIndex}`;
                }

                const connArray = state.connections[from].main[outputIndex];
                const connIndex = connArray.findIndex(
                    (c: any) => c.node === to && c.index === inputIndex
                );

                if (connIndex === -1) {
                    return `❌ Connection not found: ${from} → ${to}`;
                }

                // Remove the connection
                connArray.splice(connIndex, 1);

                saveState(state);
                return `✅ Disconnected: ${from} → ${to}`;
            }

            case 'n8n_disconnect_all_from_node': {
                const { nodeName } = args;
                if (!nodeName) {
                    return '❌ nodeName is required';
                }

                let disconnectedCount = 0;

                // Remove connections FROM this node
                if (state.connections[nodeName]) {
                    delete state.connections[nodeName];
                    disconnectedCount++;
                }

                // Remove connections TO this node
                for (const sourceNode in state.connections) {
                    if (state.connections[sourceNode]?.main) {
                        for (let i = 0; i < state.connections[sourceNode].main.length; i++) {
                            const original = state.connections[sourceNode].main[i].length;
                            state.connections[sourceNode].main[i] = state.connections[sourceNode].main[i].filter(
                                (conn: any) => conn.node !== nodeName
                            );
                            if (original !== state.connections[sourceNode].main[i].length) {
                                disconnectedCount++;
                            }
                        }
                    }
                }

                saveState(state);
                return `✅ Disconnected all connections from/to ${nodeName} (${disconnectedCount} affected)`;
            }

            case 'n8n_save_workflow': {
                const { filename, name: wfName = 'Workflow' } = args;
                const workflow = {
                    name: wfName,
                    nodes: state.nodes,
                    connections: state.connections,
                    active: false,
                    settings: {},
                    versionId: '1',
                };
                fs.writeFileSync(filename, JSON.stringify(workflow, null, 2));
                return `✅ Saved workflow to: ${filename}`;
            }

            case 'n8n_list_nodes':
                if (state.nodes.length === 0) {
                    return '📦 No nodes in current workflow';
                }
                return `📦 Nodes (${state.nodes.length}):\n` +
                    state.nodes.map((n, i) => `  ${i + 1}. ${n.name} [${n.type}]`).join('\n');

            case 'n8n_get_schema': {
                const schema = getNodeSchema().find(n => n.name === args.nodeType);
                if (!schema) {
                    return `❌ Node type not found: ${args.nodeType}`;
                }
                if (args.property) {
                    const prop = schema.properties?.find((p: any) => p.name === args.property);
                    if (!prop) {
                        return `❌ Property not found: ${args.property}`;
                    }
                    if (prop.options) {
                        return `Options for ${args.property}: ${prop.options.map((o: any) => o.value).join(', ')}`;
                    }
                    return `Property ${args.property}: type=${prop.type}, required=${prop.required || false}`;
                }
                const props = schema.properties?.map((p: any) => p.name) || [];
                return `Properties for ${args.nodeType}: ${props.join(', ')}`;
            }

            case 'n8n_get_schema_detail': {
                const result = await mcpRequest('get_schema_detail', args);
                if (result?.error) return `❌ Failed: ${result.error}`;
                return JSON.stringify(result, null, 2);
            }

            case 'n8n_create_workflow_from_state': {
                const result = await mcpRequest('create_workflow_from_state', args);
                if (result?.error) return `❌ Failed: ${result.error}`;
                return JSON.stringify(result, null, 2);
            }

            case 'n8n_workflow_update_from_state': {
                const result = await mcpRequest('workflow_update_from_state', args);
                if (result?.error) return `❌ Failed: ${result.error}`;
                return JSON.stringify(result, null, 2);
            }

            // ===== Utility =====
            case 'n8n_test_connection': {
                const result = await middlewareRequest('test_connection', {});
                if (result.success) {
                    return result.message || '✅ Connection successful';
                }
                return result.message || `❌ Connection failed: ${result.error || 'Unknown error'}`;
            }

            case 'n8n_health': {
                const result = await middlewareGet('/health');
                if (result?.error) return `❌ Failed: ${result.error}`;
                return JSON.stringify(result, null, 2);
            }

            case 'n8n_config': {
                const result = await middlewareGet('/config');
                if (result?.error) return `❌ Failed: ${result.error}`;
                return JSON.stringify(result, null, 2);
            }

            // ===== WORKFLOW API =====
            case 'n8n_workflow_list': {
                const result = await middlewareRequest('workflow_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const workflows = result.data?.data || result.data || [];
                if (!workflows.length) return '📋 No workflows found';
                return `📋 Workflows (${workflows.length}):\n` +
                    workflows.map((w: any) => `  - ${w.name} (ID: ${w.id}, Active: ${w.active})`).join('\n');
            }

            case 'n8n_workflow_read': {
                const result = await middlewareRequest('workflow_read', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                return JSON.stringify(result.data, null, 2);
            }

            case 'n8n_load_workflow_to_state': {
                const { workflowId, slotName } = args;
                const result = await middlewareRequest('workflow_read', { workflowId });

                if (result.error) return `❌ Failed to load workflow: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;

                const workflowData = result.data;
                if (!workflowData?.nodes || !workflowData?.connections) {
                    return `❌ Invalid workflow data received`;
                }

                const multiState = loadMultiState();
                const targetSlot = slotName || multiState.current;

                multiState.workflows[targetSlot] = {
                    nodes: workflowData.nodes,
                    connections: workflowData.connections,
                    metadata: {
                        workflowId: workflowData.id,
                        workflowName: workflowData.name,
                        lastModified: new Date().toISOString()
                    }
                };

                if (slotName) {
                    multiState.current = slotName;
                }

                saveMultiState(multiState);

                return `✅ Loaded workflow "${workflowData.name}" (${workflowData.nodes.length} nodes) into slot "${targetSlot}"`;
            }

            case 'n8n_switch_workflow_slot': {
                const { slotName } = args;
                const multiState = loadMultiState();

                if (!multiState.workflows[slotName]) {
                    multiState.workflows[slotName] = { nodes: [], connections: {} };
                }

                multiState.current = slotName;
                saveMultiState(multiState);

                const currentWorkflow = multiState.workflows[slotName];
                const nodeCount = currentWorkflow.nodes?.length || 0;
                const workflowName = currentWorkflow.metadata?.workflowName || 'unnamed';

                return `✅ Switched to workflow slot "${slotName}" (${nodeCount} nodes, workflow: ${workflowName})`;
            }

            case 'n8n_list_workflow_slots': {
                const multiState = loadMultiState();
                const slots = Object.keys(multiState.workflows);

                if (slots.length === 0) {
                    return '📋 No workflow slots found';
                }

                const slotInfo = slots.map(slotName => {
                    const workflow = multiState.workflows[slotName];
                    const isCurrent = slotName === multiState.current;
                    const nodeCount = workflow.nodes?.length || 0;
                    const workflowName = workflow.metadata?.workflowName || 'unnamed';
                    const workflowId = workflow.metadata?.workflowId || 'none';
                    const marker = isCurrent ? '→' : ' ';

                    return `${marker} ${slotName}: ${nodeCount} nodes, "${workflowName}" (ID: ${workflowId})`;
                }).join('\n');

                return `📋 Workflow Slots:\n${slotInfo}\n\nCurrent: ${multiState.current}`;
            }

            case 'n8n_workflow_create': {
                // Sanitize nodes according to schema before POSTing to n8n
                const allNodes = (args.nodes || state.nodes) as any[];
                const sanitizedNodes = allNodes.map((n: any) => {
                    const nodeSchema = getNodeSchema().find((s: any) => s.name === n.type);
                    const typeVersion = resolveTypeVersion(nodeSchema, n.typeVersion);
                    const parameters = sanitizeParameters(nodeSchema, n.parameters || {}, typeVersion);
                    const out: any = {
                        parameters,
                        id: n.id,
                        name: n.name,
                        type: n.type,
                        typeVersion: Math.floor(typeVersion),
                        position: Array.isArray(n.position) ? n.position : [0, 0],
                    };
                    if (n.credentials) out.credentials = n.credentials;
                    if (n.disabled !== undefined) out.disabled = n.disabled;
                    if (n.notes !== undefined) out.notes = n.notes;
                    // Do NOT include webhookId or any other computed/internal fields
                    return out;
                });

                const payload = {
                    name: args.name,
                    nodes: sanitizedNodes,
                    connections: args.connections || state.connections,
                };

                const result = await middlewareRequest('workflow_create', payload);
                if (result.data?.id) return `✅ Created workflow: ${result.data?.name} (ID: ${result.data?.id})`;
                if (result.error) return `❌ Failed: ${result.error}`;
                return `❌ Failed: ${JSON.stringify(result)}`;
            }

            case 'n8n_workflow_update': {
                const result = await middlewareRequest('workflow_update', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Workflow updated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_workflow_delete': {
                const result = await middlewareRequest('workflow_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ Workflow deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_workflow_activate': {
                const result = await middlewareRequest('workflow_activate', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Workflow activated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_workflow_deactivate': {
                const result = await middlewareRequest('workflow_deactivate', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Workflow deactivated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_workflow_move': {
                const result = await middlewareRequest('workflow_move', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Workflow moved`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_execute_workflow': {
                const result = await middlewareRequest('execute_workflow', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Execution started: ${JSON.stringify(result.data)}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_diagnose_workflow': {
                const result = await middlewareRequest('workflow_diagnose', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const data = result.data?.data || result.data;
                const diag = data?.diagnostics;
                const node = diag?.node?.name || diag?.node?.type ? ` (${diag?.node?.name || 'unknown'} / ${diag?.node?.type || 'unknown'})` : '';
                const status = diag?.status || 'unknown';
                const lastNode = diag?.lastNodeExecuted || 'unknown';
                const errMsg = diag?.error?.message || diag?.error?.description || diag?.error?.name || null;

                let summary = `🧪 Diagnostics: execution ${data?.executionId || 'unknown'}\n`;
                summary += `Status: ${status}\n`;
                summary += `Last node executed: ${lastNode}${node}\n`;
                if (errMsg) summary += `Error: ${errMsg}\n`;

                if (diag?.stack) {
                    summary += `\nStack:\n${String(diag.stack).substring(0, 4000)}`;
                    return summary;
                }

                // If no stack, return compact summary plus JSON for full diagnostics
                return `${summary}\n${JSON.stringify(data, null, 2)}`;
            }

            // ===== EXECUTION API =====
            case 'n8n_execution_list': {
                const result = await middlewareRequest('execution_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const execs = result.data?.data || result.data || [];
                if (!execs.length) return '📜 No executions found';
                return `📜 Executions (${execs.length}):\n` +
                    execs.slice(0, 10).map((e: any) => `  - ${e.id}: ${e.status} (${e.finished ? 'finished' : 'running'})`).join('\n');
            }

            case 'n8n_execution_read': {
                const result = await middlewareRequest('execution_read', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                return JSON.stringify(result.data, null, 2);
            }

            case 'n8n_execution_delete': {
                const result = await middlewareRequest('execution_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ Execution deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_execution_retry': {
                const result = await middlewareRequest('execution_retry', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Execution retry started`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== CREDENTIAL API =====
            case 'n8n_credential_list': {
                const result = await middlewareRequest('credential_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const creds = result.data?.data || result.data || [];
                if (!creds.length) return '🔑 No credentials found';
                return `🔑 Credentials (${creds.length}):\n` + creds.map((c: any) => `  - ${c.name} (${c.type}, ID: ${c.id})`).join('\n');
            }

            case 'n8n_credential_create': {
                const result = await middlewareRequest('credential_create', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 201) return `✅ Credential created: ${result.data?.name}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_credential_delete': {
                const result = await middlewareRequest('credential_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ Credential deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_credential_move': {
                const result = await middlewareRequest('credential_move', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Credential moved`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== TAG API =====
            case 'n8n_tag_list': {
                const result = await middlewareRequest('tag_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const tags = result.data?.data || result.data || [];
                if (!tags.length) return '🏷️ No tags found';
                return `🏷️ Tags (${tags.length}):\n` + tags.map((t: any) => `  - ${t.name} (ID: ${t.id})`).join('\n');
            }

            case 'n8n_tag_read': {
                const result = await middlewareRequest('tag_read', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                return JSON.stringify(result.data, null, 2);
            }

            case 'n8n_tag_create': {
                const result = await middlewareRequest('tag_create', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 201) return `✅ Tag created: ${result.data?.name}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_tag_update': {
                const result = await middlewareRequest('tag_update', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Tag updated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_tag_delete': {
                const result = await middlewareRequest('tag_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ Tag deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== WORKFLOW TAGS API =====
            case 'n8n_workflowtags_list': {
                const result = await middlewareRequest('workflowtags_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const tags = result.data?.tags || result.data || [];
                if (!tags.length) return '🏷️ No tags on this workflow';
                return `🏷️ Workflow Tags:\n` + tags.map((t: any) => `  - ${t.name} (ID: ${t.id})`).join('\n');
            }

            case 'n8n_workflowtags_update': {
                const result = await middlewareRequest('workflowtags_update', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Workflow tags updated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== VARIABLE API =====
            case 'n8n_variable_list': {
                const result = await middlewareRequest('variable_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const vars = result.data?.data || result.data || [];
                if (!vars.length) return '📝 No variables found';
                return `📝 Variables (${vars.length}):\n` + vars.map((v: any) => `  - ${v.key} = ${v.value} (ID: ${v.id})`).join('\n');
            }

            case 'n8n_variable_create': {
                const result = await middlewareRequest('variable_create', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 201) return `✅ Variable created: ${args.key}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_variable_update': {
                const result = await middlewareRequest('variable_update', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Variable updated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_variable_delete': {
                const result = await middlewareRequest('variable_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ Variable deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== USER API =====
            case 'n8n_user_list': {
                const result = await middlewareRequest('user_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const users = result.data?.data || result.data || [];
                if (!users.length) return '👤 No users found';
                return `👤 Users (${users.length}):\n` + users.map((u: any) => `  - ${u.email} (ID: ${u.id}, Role: ${u.role || 'N/A'})`).join('\n');
            }

            case 'n8n_user_read': {
                const result = await middlewareRequest('user_read', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                return JSON.stringify(result.data, null, 2);
            }

            case 'n8n_user_create': {
                const result = await middlewareRequest('user_create', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 201) return `✅ User created: ${args.email}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_user_delete': {
                const result = await middlewareRequest('user_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ User deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_user_changeRole': {
                const result = await middlewareRequest('user_changeRole', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ User role changed to ${args.role}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_user_enforceMfa': {
                const result = await middlewareRequest('user_enforceMfa', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ MFA ${args.enabled ? 'enabled' : 'disabled'} for user`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== PROJECT API =====
            case 'n8n_project_list': {
                const result = await middlewareRequest('project_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const projects = result.data?.data || result.data || [];
                if (!projects.length) return '📁 No projects found';
                return `📁 Projects (${projects.length}):\n` + projects.map((p: any) => `  - ${p.name} (ID: ${p.id})`).join('\n');
            }

            case 'n8n_project_create': {
                const result = await middlewareRequest('project_create', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 201) return `✅ Project created: ${result.data?.name}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_project_update': {
                const result = await middlewareRequest('project_update', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Project updated`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_project_delete': {
                const result = await middlewareRequest('project_delete', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 204) return `✅ Project deleted`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== SOURCE CONTROL API =====
            case 'n8n_sourcecontrol_pull': {
                const result = await middlewareRequest('sourcecontrol_pull', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Source control pull completed`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== SECURITY AUDIT API =====
            case 'n8n_securityaudit_generate': {
                const result = await middlewareRequest('securityaudit_generate', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Security audit:\n${JSON.stringify(result.data, null, 2)}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            // ===== Legacy aliases for backward compatibility =====
            case 'n8n_list_workflows': {
                const result = await middlewareRequest('workflow_list', {});
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const workflows = result.data?.data || result.data || [];
                if (!workflows.length) return '📋 No workflows found';
                return `📋 Workflows (${workflows.length}):\n` + workflows.map((w: any) => `  - ${w.name} (ID: ${w.id})`).join('\n');
            }

            case 'n8n_get_workflow': {
                const result = await middlewareRequest('workflow_read', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                return JSON.stringify(result.data, null, 2);
            }

            case 'n8n_create_workflow': {
                const result = await middlewareRequest('workflow_create', {
                    name: args.name,
                    nodes: args.nodes || state.nodes,
                    connections: args.connections || state.connections,
                });
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200 || result.status === 201) return `✅ Created: ${result.data?.name}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_activate_workflow': {
                const result = await middlewareRequest(args.active ? 'workflow_activate' : 'workflow_deactivate', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status === 200) return `✅ Workflow ${args.active ? 'activated' : 'deactivated'}`;
                return `❌ Failed: HTTP ${result.status}`;
            }

            case 'n8n_list_executions': {
                const result = await middlewareRequest('execution_list', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const execs = result.data?.data || result.data || [];
                if (!execs.length) return '📜 No executions found';
                return `📜 Executions:\n` + execs.slice(0, 10).map((e: any) => `  - ${e.id}: ${e.status}`).join('\n');
            }

            case 'n8n_list_credentials': {
                const result = await middlewareRequest('credential_list', {});
                if (result.error) return `❌ Failed: ${result.error}`;
                if (result.status !== 200) return `❌ Failed: HTTP ${result.status}`;
                const creds = result.data?.data || result.data || [];
                if (!creds.length) return '🔑 No credentials found';
                return `🔑 Credentials:\n` + creds.map((c: any) => `  - ${c.name} (${c.type})`).join('\n');
            }

            // ===== BROWSER AUTOMATION =====
            case 'browser_click': {
                const result = await browserRequest('click', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                return `✅ Clicked`;
            }



            // ===== BROWSER AUTOMATION =====
            case 'browser_click': {
                const result = await browserRequest('click', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                return `✅ Clicked`;
            }

            case 'browser_type': {
                const result = await browserRequest('type', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                return `✅ Typed "${args.text}"`;
            }

            case 'browser_screenshot': {
                const result = await browserRequest('screenshot', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                return `✅ Screenshot captured (base64 length: ${result.data?.data?.length})`;
            }

            case 'browser_eval': {
                const result = await browserRequest('eval', { text: args.expression });
                if (result.error) return `❌ Failed: ${result.error}`;
                return `✅ Result: ${JSON.stringify(result.data)}`;
            }

            case 'browser_get_tree': {
                const result = await browserRequest('tree', args);
                if (result.error) return `❌ Failed: ${result.error}`;
                return `✅ UI Tree: ${JSON.stringify(result.data)}`;
            }

            default:
                return `❌ Unknown tool: ${name}`;
        }
    } catch (e: any) {
        return `❌ Error: ${e.message}`;
    }
}


/**
 * Truncate response string to avoid context window overflow
 */
function truncateString(str: string, limit = 8000): string {
    if (str.length <= limit) return str;
    return str.substring(0, limit) + `\n... [truncated ${str.length - limit} chars]`;
}

/**
 * Main server
 */
async function main() {
    const server = new Server(
        { name: 'n8n-agent-server', version: '0.1.0' },
        { capabilities: { tools: {} } }
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        console.error(`[MCP] Tool called: ${name} with args:`, JSON.stringify(args).substring(0, 100));
        const startTime = Date.now();
        const result = await handleToolCall(name, args || {});
        const duration = Date.now() - startTime;
        console.error(`[MCP] Tool ${name} completed in ${duration}ms`);
        return { content: [{ type: 'text', text: truncateString(result) }] };
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('N8N Agent MCP Server running on stdio');
}

main().catch(console.error);
