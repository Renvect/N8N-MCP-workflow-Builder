/**
 * N8N Agent Middleware - HTTP API Server
 * 
 * Exposes HTTP endpoints for MCP server to call instead of n8n directly.
 * This allows centralized configuration, logging, and request handling.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type Store from 'electron-store';

// Use any for store type to avoid TypeScript generics mismatch
type ConfigStore = Store<any>;

const API_PORT = parseInt(process.env.API_PORT || '3456', 10);

interface N8nConfig {
    n8nUrl: string;
    n8nAuthType: 'apikey' | 'basic' | 'none';
    n8nApiKey: string;
    n8nEmail: string;
    n8nPassword: string;
}


// Store reference passed from main process
let configStore: any = null;
let browserActionHandler: ((action: any) => Promise<any>) | null = null;

/**
 * Get current n8n configuration from electron-store
 */
function getN8nConfig(): N8nConfig {
    if (!configStore) {
        return {
            n8nUrl: '',
            n8nAuthType: 'apikey',
            n8nApiKey: '',
            n8nEmail: '',
            n8nPassword: '',
        };
    }

    return {
        n8nUrl: (configStore.get('n8nUrl') as string) || '',
        n8nAuthType: (configStore.get('n8nAuthType') as string || 'apikey') as 'apikey' | 'basic' | 'none',
        n8nApiKey: (configStore.get('n8nApiKey') as string) || '',
        n8nEmail: (configStore.get('n8nEmail') as string) || '',
        n8nPassword: (configStore.get('n8nPassword') as string) || '',
    };
}


/**
 * Make authenticated request to n8n API
 */
async function n8nRequest(method: string, endpoint: string, body?: any): Promise<{ status: number; data: any }> {
    const config = getN8nConfig();

    if (!config.n8nUrl || config.n8nUrl.trim().length === 0) {
        throw new Error('n8nUrl is required');
    }
    const hasApiKey = !!(config.n8nApiKey && config.n8nApiKey.trim().length > 0);
    const hasBasic = !!(
        config.n8nEmail &&
        config.n8nEmail.trim().length > 0 &&
        config.n8nPassword &&
        config.n8nPassword.trim().length > 0
    );
    if (!hasApiKey && !hasBasic) {
        throw new Error('n8nApiKey or (n8nEmail and n8nPassword) is required');
    }

    const baseUrl = config.n8nUrl.replace(/\/$/, '');
    const url = new URL(endpoint, baseUrl);
    const protocol = url.protocol === 'https:' ? https : http;

    let token: string | null = null;
    if (config.n8nAuthType === 'apikey' && config.n8nApiKey) {
        token = config.n8nApiKey;
    }

    const basicAuthEmail = config.n8nEmail || '';
    const basicAuthPassword = config.n8nPassword || '';

    const canUseBasic = !!(
        basicAuthEmail &&
        basicAuthEmail.trim().length > 0 &&
        basicAuthPassword &&
        basicAuthPassword.trim().length > 0
    );

    const defaultAuthScheme: 'bearer' | 'x' | 'basic' | 'none' = token ? 'x' : (canUseBasic ? 'basic' : 'none');

    const makeRequest = (scheme: 'bearer' | 'x' | 'basic' | 'none') => {
        return new Promise<{ status: number; data: any }>((resolve, reject) => {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
            };

            if (scheme === 'bearer' && token) {
                headers['Authorization'] = `Bearer ${token}`;
            } else if (scheme === 'x' && token) {
                headers['X-N8N-API-KEY'] = token;
            } else if (scheme === 'basic' && basicAuthEmail && basicAuthPassword) {
                const auth = Buffer.from(`${basicAuthEmail}:${basicAuthPassword}`).toString('base64');
                headers['Authorization'] = `Basic ${auth}`;
            }

            const options = {
                hostname: url.hostname,
                port: url.port || (url.protocol === 'https:' ? 443 : 80),
                path: url.pathname + url.search,
                method,
                headers,
            };

            const req = protocol.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode || 500, data: JSON.parse(data) });
                    } catch {
                        resolve({ status: res.statusCode || 500, data });
                    }
                });
            });

            req.on('error', (e) => {
                reject(e);
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    };

    const firstAttempt = await makeRequest(defaultAuthScheme);
    if (firstAttempt.status === 401 && defaultAuthScheme === 'x') {
        return await makeRequest('bearer');
    }

    return firstAttempt;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Request logging middleware
 */
function requestLogger(req: Request, res: Response, next: NextFunction): void {
    const startTime = Date.now();
    const { method, path, body } = req;

    console.log(`[API] → ${method} ${path}`, body ? JSON.stringify(body).substring(0, 200) : '');

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        console.log(`[API] ← ${method} ${path} [${res.statusCode}] ${duration}ms`);
    });

    next();
}

// ===== MCP parity: shared schema + state helpers =====
// Use the same schema file as MCP server (rust-core/node-types-schema.json)
const SCHEMA_PATH_CANDIDATES = [
    ...((typeof (process as any).resourcesPath === 'string')
        ? [path.join((process as any).resourcesPath, 'rust-core', 'node-types-schema.json')]
        : []),
    path.resolve(__dirname, '..', '..', 'rust-core', 'node-types-schema.json'),
    path.resolve(__dirname, '..', 'rust-core', 'node-types-schema.json'),
    path.resolve(__dirname, '..', '..', '..', '..', 'rust-core', 'node-types-schema.json'),
    path.resolve(process.cwd(), 'rust-core', 'node-types-schema.json'),
];

let NODE_SCHEMA: any[] | null = null;

type SchemaSource = 'supabase' | 'remote' | 'remote-session' | 'local' | 'none';
let NODE_SCHEMA_META: { fetchedAt: number; source: SchemaSource; hash: string; cacheKey: string } = {
    fetchedAt: 0,
    source: 'none',
    hash: '',
    cacheKey: '',
};

let NODE_SCHEMA_FETCHED_AT = 0;
let NODE_SCHEMA_INFLIGHT: Promise<any[]> | null = null;
let NODE_SCHEMA_CACHE_KEY = '';
const NODE_SCHEMA_TTL_MS = 15 * 60 * 1000;

function loadLocalNodeSchema(): any[] {
    for (const p of SCHEMA_PATH_CANDIDATES) {
        try {
            if (fs.existsSync(p)) {
                const data = JSON.parse(fs.readFileSync(p, 'utf8'));
                return Array.isArray(data) ? data : [];
            }
        } catch {
            // ignore and continue
        }
    }
    return [];
}

function normalizeRemoteSchemaPayload(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray((data as any).data)) return (data as any).data;
    if (Array.isArray((data as any)?.data?.nodeTypes)) return (data as any).data.nodeTypes;
    if (Array.isArray((data as any)?.data?.nodes)) return (data as any).data.nodes;
    if (Array.isArray((data as any)?.data?.types)) return (data as any).data.types;
    if (Array.isArray((data as any).nodeTypes)) return (data as any).nodeTypes;
    if (Array.isArray((data as any).nodes)) return (data as any).nodes;
    if (Array.isArray((data as any).types)) return (data as any).types;
    return [];
}

function computeSchemaHash(schema: any[]): string {
    try {
        return crypto.createHash('sha256').update(JSON.stringify(schema)).digest('hex');
    } catch {
        return '';
    }
}

// Supabase schema fetching logic removed as requested
// We only use n8n instance (remote or session) or local file fallback

async function fetchRemoteNodeSchemaWithCurrentAuth(): Promise<any[] | null> {
    const candidates = [
        '/types/nodes.json',
        '/types/nodes.json?full=true',
        '/types/nodes.json?showDescriptions=true',
        '/api/v1/node-types',
        '/api/v1/node-types?includeProperties=true',
        '/api/v1/node-types?onlyLatest=true',
        '/rest/node-types',
        '/rest/node-types?includeProperties=true',
        '/rest/node-types?onlyLatest=true',
    ];
    for (const endpoint of candidates) {
        try {
            const result = await n8nRequest('GET', endpoint);
            if (result.status !== 200) continue;
            const schema = normalizeRemoteSchemaPayload(result.data);
            if (schema.length > 0) return schema;
        } catch {
            // ignore and try next
        }
    }
    return null;
}

async function fetchRemoteNodeSchemaWithSession(): Promise<any[] | null> {
    const cfg = getN8nConfig();
    if (cfg.n8nAuthType !== 'basic') return null;
    if (!cfg.n8nEmail || !cfg.n8nPassword) return null;

    const baseUrl = cfg.n8nUrl.replace(/\/$/, '');

    const loginUrl = new URL('/rest/login', baseUrl);
    const protocol = loginUrl.protocol === 'https:' ? https : http;

    const cookieHeader = await new Promise<string>((resolve, reject) => {
        const payload = JSON.stringify({
            email: cfg.n8nEmail,
            emailOrLdapLoginId: cfg.n8nEmail,
            password: cfg.n8nPassword,
        });

        const req = protocol.request({
            hostname: loginUrl.hostname,
            port: loginUrl.port || (loginUrl.protocol === 'https:' ? 443 : 80),
            path: loginUrl.pathname + loginUrl.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
            },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if ((res.statusCode || 500) >= 400) {
                    reject(new Error(`Session login failed (${res.statusCode}): ${body}`));
                    return;
                }
                const setCookie = (res.headers['set-cookie'] || []) as string[];
                const header = setCookie.map((c) => c.split(';')[0]).join('; ');
                resolve(header);
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });

    if (!cookieHeader) return null;

    const schemaUrl = new URL('/types/nodes.json?showDescriptions=true', baseUrl);
    const protocol2 = schemaUrl.protocol === 'https:' ? https : http;
    const schemaText = await new Promise<string>((resolve, reject) => {
        const req = protocol2.request({
            hostname: schemaUrl.hostname,
            port: schemaUrl.port || (schemaUrl.protocol === 'https:' ? 443 : 80),
            path: schemaUrl.pathname + schemaUrl.search,
            method: 'GET',
            headers: {
                'Cookie': cookieHeader,
                'Accept': 'application/json',
            },
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                if ((res.statusCode || 500) >= 400) {
                    reject(new Error(`Failed to fetch schema (${res.statusCode}): ${body}`));
                    return;
                }
                resolve(body);
            });
        });
        req.on('error', reject);
        req.end();
    });

    try {
        const parsed = JSON.parse(schemaText);
        const schema = normalizeRemoteSchemaPayload(parsed);
        return schema.length > 0 ? schema : null;
    } catch {
        return null;
    }
}

async function getNodeSchema(refresh = false): Promise<any[]> {
    const now = Date.now();
    const cfg = getN8nConfig();
    const cacheKey = [
        cfg.n8nUrl,
        cfg.n8nAuthType,
        cfg.n8nApiKey,
        cfg.n8nEmail,
        cfg.n8nPassword,
    ].join('|');

    if (NODE_SCHEMA_CACHE_KEY && NODE_SCHEMA_CACHE_KEY !== cacheKey) {
        NODE_SCHEMA = null;
        NODE_SCHEMA_FETCHED_AT = 0;
    }
    NODE_SCHEMA_CACHE_KEY = cacheKey;

    if (!refresh && NODE_SCHEMA && now - NODE_SCHEMA_FETCHED_AT < NODE_SCHEMA_TTL_MS) return NODE_SCHEMA;
    if (NODE_SCHEMA_INFLIGHT) return await NODE_SCHEMA_INFLIGHT;

    NODE_SCHEMA_INFLIGHT = (async () => {
        let schema: any[] | null = null;
        let source: SchemaSource = 'none';

        // PRIORITY 1: Try n8n directly first (remote auth)
        schema = await fetchRemoteNodeSchemaWithCurrentAuth();
        if (schema && schema.length > 0) {
            source = 'remote';
        }

        // PRIORITY 2: Try n8n with session auth (for self-hosted with basic auth)
        if (!schema || schema.length === 0) {
            const viaSession = await fetchRemoteNodeSchemaWithSession();
            if (viaSession && viaSession.length > 0) {
                schema = viaSession;
                source = 'remote-session';
            }
        }


        // No Supabase fallback - only n8n sources

        if (!schema || schema.length === 0) {
            schema = loadLocalNodeSchema();
            source = schema.length > 0 ? 'local' : 'none';
        }

        if (NODE_SCHEMA_CACHE_KEY === cacheKey) {
            NODE_SCHEMA = schema;
            NODE_SCHEMA_FETCHED_AT = Date.now();
            NODE_SCHEMA_META = {
                fetchedAt: NODE_SCHEMA_FETCHED_AT,
                source,
                hash: computeSchemaHash(schema),
                cacheKey,
            };
        }

        return schema;
    })().finally(() => {
        NODE_SCHEMA_INFLIGHT = null;
    });

    return await NODE_SCHEMA_INFLIGHT;
}

// Multi-workflow state file shared with MCP server
const MULTI_STATE_FILE = path.resolve(__dirname, '..', '..', 'mcp-server', '.agent_multi_workflow_state.json');
const SINGLE_STATE_FILE = path.resolve(__dirname, '..', '..', 'mcp-server', '.agent_tool_state.json');

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
    current: string;
    workflows: Record<string, WorkflowState>;
}

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
    fs.writeFileSync(MULTI_STATE_FILE, JSON.stringify(state, null, 2));
}

function loadState(): WorkflowState {
    const multi = loadMultiState();
    return multi.workflows[multi.current] || { nodes: [], connections: {} };
}

function saveState(st: WorkflowState): void {
    const multi = loadMultiState();
    multi.workflows[multi.current] = {
        ...st,
        metadata: {
            ...st.metadata,
            lastModified: new Date().toISOString(),
        },
    };
    saveMultiState(multi);
    // also persist legacy single-state for compatibility
    fs.writeFileSync(SINGLE_STATE_FILE, JSON.stringify(st, null, 2));
}

// Schema helpers (aligned with MCP server)
function getAllowedTypeVersions(nodeSchema: any): number[] {
    if (!nodeSchema) return [];
    const versions: number[] = [];
    if (Array.isArray(nodeSchema?.version)) {
        for (const v of nodeSchema.version) if (typeof v === 'number') versions.push(v);
    } else if (typeof nodeSchema?.version === 'number') versions.push(nodeSchema.version);
    if (typeof nodeSchema?.defaultVersion === 'number') versions.push(nodeSchema.defaultVersion);
    return Array.from(new Set(versions));
}

function resolveTypeVersion(nodeSchema: any, requestedTypeVersion?: number): number {
    const versions = getAllowedTypeVersions(nodeSchema);
    const maxVersion = versions.length > 0 ? Math.max(...versions) : 1;

    // Force usage of latest version as per user requirement "filter only latest and use"
    // Also logging for debug purposes
    if (process.env.DEBUG_SCHEMA) {
        console.log(`[Schema] Resolved version for ${nodeSchema?.name}: requested=${requestedTypeVersion}, available=[${versions.join(',')}], selected=${Math.floor(maxVersion)}`);
    }

    return Math.floor(maxVersion);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDisplayOptionKey(key: string): string {
    const k = String(key || '').trim();
    if (!k) return '';
    if (k === '@version') return '@version';
    if (k.startsWith('/')) return k.slice(1).replace(/\//g, '.');
    return k;
}

function getNestedValue(obj: any, p: string): any {
    if (!obj || !p) return undefined;
    const parts = String(p).split('.').filter(Boolean);
    let current: any = obj;
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    return current;
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
        if (!propByName.has(key)) delete out[key];
    }
    // Strip invisible fields
    for (const key of Object.keys(out)) {
        const propSchema = propByName.get(key);
        if (!propSchema) continue;
        if (!isPropertyVisible(propSchema, out, typeVersion)) delete out[key];
    }
    // Fix shapes
    for (const propSchema of schemaProps) {
        const name = propSchema.name;
        if (!(name in out)) continue;
        if (!isPropertyVisible(propSchema, out, typeVersion)) continue;
        const t = String(propSchema.type || '').toLowerCase();
        const v = out[name];
        if ((t === 'collection' || t === 'fixedcollection') && v !== undefined && v !== null && !isPlainObject(v)) out[name] = {};
        if (t === 'multioptions' && v !== undefined && v !== null && !Array.isArray(v)) out[name] = [v];
        if (t === 'options' && Array.isArray(v)) out[name] = v.length > 0 ? v[0] : undefined;
    }
    // Fill required defaults
    for (const propSchema of schemaProps) {
        const name = propSchema.name;
        const visible = isPropertyVisible(propSchema, out, typeVersion);
        if (!visible) continue;
        if (!propSchema.required) continue;
        if (out[name] !== undefined) continue;
        if (propSchema.default !== undefined) { out[name] = propSchema.default; continue; }
        const t = String(propSchema.type || '').toLowerCase();
        if (t === 'collection' || t === 'fixedcollection') out[name] = {};
        if (t === 'multioptions') out[name] = [];
    }
    return out;
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

function isAiType(t: unknown): boolean {
    const s = String(t || '').trim();
    return s.startsWith('ai_');
}

function getNodeByName(state: WorkflowState, nodeName: string): any | null {
    return (state?.nodes || []).find((n: any) => n?.name === nodeName) || null;
}

function getSchemaDefForNode(schema: any[], state: WorkflowState, nodeName: string): any | null {
    const node = getNodeByName(state, nodeName);
    if (!node?.type) return null;
    return (schema || []).find((s: any) => s?.name === node.type) || null;
}

function getIncomingCount(connections: Record<string, any>, targetNode: string, inputType: string, inputIndex: number): number {
    let count = 0;
    for (const byOutput of Object.values(connections || {})) {
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

function ensureConnectionArray(state: WorkflowState, from: string, outputType: string, outputIndex: number): void {
    if (!state.connections) (state as any).connections = {};
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

    if (desired) return tryPick(desired);

    const priority = ['ai_languageModel', 'ai_tool', 'ai_memory', 'ai_outputParser'];
    for (const t of priority) {
        const picked = tryPick(t);
        if (picked) return picked;
    }
    return null;
}

function pickInputIndex(state: WorkflowState, to: string, toDef: any, inputType: string, requestedIndex?: number): number {
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
            return idx;
        }
    }
    return slotIndices[0];
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

function createNodeFromSchema(nodeSpec: any, schema: any[]): any {
    const type = nodeSpec?.type || nodeSpec?.nodeType;
    if (!type) throw new Error('Node type is required');

    const nodeSchema = Array.isArray(schema) ? schema.find((s: any) => s && s.name === type) : null;
    if (!nodeSchema) throw new Error(`Node type not found in schema: ${type}`);

    const requestedVersion = nodeSpec?.typeVersion;
    const typeVersion = resolveTypeVersion(nodeSchema, typeof requestedVersion === 'number' ? requestedVersion : undefined);
    const parameters = sanitizeParameters(nodeSchema, nodeSpec?.parameters || {}, typeVersion);

    const id = nodeSpec?.id
        ? String(nodeSpec.id)
        : (typeof (crypto as any).randomUUID === 'function' ? (crypto as any).randomUUID() : crypto.randomBytes(16).toString('hex'));

    const name = nodeSpec?.name || String(type).split('.').pop() || String(type);
    const position = Array.isArray(nodeSpec?.position) ? nodeSpec.position : [0, 0];

    const out: any = {
        id,
        name,
        type,
        typeVersion: Math.floor(typeVersion),
        position,
        parameters,
    };

    if (nodeSpec?.credentials) out.credentials = nodeSpec.credentials;
    if (nodeSpec?.disabled !== undefined) out.disabled = nodeSpec.disabled;
    if (nodeSpec?.notes !== undefined) out.notes = nodeSpec.notes;
    if (type === 'n8n-nodes-base.webhook') {
        out.webhookId = crypto.randomBytes(4).toString('hex');
    }

    return out;
}

/**
 * Create and configure Express app
 */
function createApp(): express.Application {
    const app = express();

    // SECURITY: Restrict CORS to localhost only
    // This prevents cross-origin requests from external websites
    const corsOptions = {
        origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
            // Allow requests with no origin (like from the same machine, curl, etc.)
            if (!origin) {
                callback(null, true);
                return;
            }

            // Only allow localhost origins
            const allowedOrigins = [
                'http://localhost',
                'http://127.0.0.1',
                'http://localhost:3456',
                'http://127.0.0.1:3456',
                // Allow Electron app origins
                'file://',
            ];

            const isAllowed = allowedOrigins.some(allowed =>
                origin.startsWith(allowed) || origin === allowed
            );

            if (isAllowed) {
                callback(null, true);
            } else {
                console.warn(`[Security] Blocked CORS request from origin: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        },
        credentials: true,
    };

    app.use(cors(corsOptions));
    app.use(express.json({ limit: '10mb' })); // Limit request body size
    app.use(requestLogger);

    // Health check
    app.get('/api/health', async (_req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', '/api/v1/workflows?limit=1');
            res.json({
                status: 'ok',
                n8nConnected: result.status === 200,
                port: API_PORT,
            });
        } catch (e: any) {
            res.json({
                status: 'ok',
                n8nConnected: false,
                error: e.message,
                port: API_PORT,
            });
        }
    });

    // Get current config status (without sensitive data)
    app.get('/api/config', (_req: Request, res: Response) => {
        const config = getN8nConfig();
        res.json({
            n8nUrl: config.n8nUrl,
            hasApiKey: !!config.n8nApiKey,
            authType: config.n8nAuthType,
        });
    });

    // ===== N8N PROXY ENDPOINTS =====
    // These mirror the n8n API and allow MCP to call through middleware

    // Test connection
    app.post('/api/n8n/test_connection', async (_req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', '/api/v1/workflows?limit=1');
            if (result.status === 200) {
                res.json({ success: true, message: '✅ Connection successful' });
                return;
            }

            const restAttempt = await n8nRequest('GET', '/rest/workflows');
            if (restAttempt.status === 200) {
                res.json({ success: true, message: '✅ Connection successful (REST API)' });
                return;
            }

            res.json({ success: false, message: `❌ Connection failed: HTTP ${result.status} (Public API), HTTP ${restAttempt.status} (REST)` });
        } catch (e: any) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ===== WORKFLOW API =====
    app.post('/api/n8n/workflow_list', async (req: Request, res: Response) => {
        try {
            let url = '/api/v1/workflows';
            const params: string[] = [];
            if (req.body.active !== undefined) params.push(`active=${req.body.active}`);
            if (req.body.tags) params.push(`tags=${req.body.tags}`);
            if (req.body.projectId) params.push(`projectId=${req.body.projectId}`);
            if (params.length) url += '?' + params.join('&');

            const result = await n8nRequest('GET', url);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_read', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', `/api/v1/workflows/${req.body.workflowId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_create', async (req: Request, res: Response) => {
        try {
            const { name, nodes, connections } = req.body;
            console.log('[API] Creating workflow with', nodes?.length || 0, 'nodes');
            const result = await n8nRequest('POST', '/api/v1/workflows', {
                name,
                nodes: nodes || [],
                connections: connections || {},
                settings: {},
            });
            // Always return full result including any errors from n8n
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message, status: 500 });
        }
    });

    app.post('/api/n8n/workflow_update', async (req: Request, res: Response) => {
        try {
            const { workflowId, ...updates } = req.body;

            // n8n API v1 PUT requires full workflow body
            // First fetch current workflow, then merge updates
            const current = await n8nRequest('GET', `/api/v1/workflows/${workflowId}`);
            if (current.status !== 200) {
                res.json({ status: current.status, data: current.data, error: 'Failed to fetch workflow for update' });
                return;
            }

            const allowedFields = ['name', 'nodes', 'connections', 'settings'];
            const updatedWorkflow: any = {};

            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    updatedWorkflow[field] = updates[field];
                } else if (current.data[field] !== undefined && current.data[field] !== null) {
                    updatedWorkflow[field] = current.data[field];
                }
            }

            // Clean nodes - only keep allowed node properties
            if (updatedWorkflow.nodes) {
                const nodeAllowed = ['id', 'name', 'type', 'typeVersion', 'position', 'parameters', 'credentials', 'disabled', 'notes', 'notesInFlow', 'webhookId', 'extendsCredential'];
                updatedWorkflow.nodes = updatedWorkflow.nodes.map((node: any) => {
                    const cleanNode: any = {};
                    for (const key of nodeAllowed) {
                        if (node[key] !== undefined) cleanNode[key] = node[key];
                    }
                    return cleanNode;
                });
            }

            // Clean settings - remove availableInMCP if present (not a valid n8n setting)
            if (updatedWorkflow.settings) {
                delete updatedWorkflow.settings.availableInMCP;
            }

            const result = await n8nRequest('PUT', `/api/v1/workflows/${workflowId}`, updatedWorkflow);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/workflows/${req.body.workflowId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_activate', async (req: Request, res: Response) => {
        try {
            const { workflowId, ...activationOptions } = req.body || {};
            const body = Object.keys(activationOptions).length ? activationOptions : undefined;
            const result = await n8nRequest('POST', `/api/v1/workflows/${workflowId}/activate`, body);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_deactivate', async (req: Request, res: Response) => {
        try {
            const { workflowId, ...deactivationOptions } = req.body || {};
            const body = Object.keys(deactivationOptions).length ? deactivationOptions : undefined;
            const result = await n8nRequest('POST', `/api/v1/workflows/${workflowId}/deactivate`, body);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_move', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PUT', `/api/v1/workflows/${req.body.workflowId}/transfer`, {
                destinationProjectId: req.body.destinationProjectId,
            });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== EXECUTION API =====
    app.post('/api/n8n/execution_list', async (req: Request, res: Response) => {
        try {
            let url = '/api/v1/executions';
            const params: string[] = [];
            if (req.body.workflowId) params.push(`workflowId=${req.body.workflowId}`);
            if (req.body.status) params.push(`status=${req.body.status}`);
            if (req.body.limit) params.push(`limit=${req.body.limit}`);
            if (req.body.includeData) params.push('includeData=true');
            if (params.length) url += '?' + params.join('&');

            const result = await n8nRequest('GET', url);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/execution_read', async (req: Request, res: Response) => {
        try {
            let url = `/api/v1/executions/${req.body.executionId}`;
            if (req.body.includeData) url += '?includeData=true';
            const result = await n8nRequest('GET', url);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/execution_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/executions/${req.body.executionId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/execution_retry', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', `/api/v1/executions/${req.body.executionId}/retry`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/execute_workflow', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', `/api/v1/workflows/${req.body.workflowId}/run`, req.body.data || {});
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflow_diagnose', async (req: Request, res: Response) => {
        const {
            workflowId,
            data,
            wait = true,
            timeoutMs = 60000,
            pollIntervalMs = 1000,
            ensureSaveData = true,
            restoreSettings = true,
            includeExecution = false,
        } = req.body || {};

        if (!workflowId) {
            res.json({ status: 400, error: 'workflowId is required' });
            return;
        }

        let originalSettings: any | null = null;
        let settingsPatched = false;
        const warnings: string[] = [];

        const extractExecutionId = (runResult: any): string | null => {
            const candidates = [
                runResult?.executionId,
                runResult?.id,
                runResult?.data?.executionId,
                runResult?.data?.id,
                runResult?.data?.execution?.id,
            ];
            const found = candidates.find((c) => c !== undefined && c !== null && String(c).trim() !== '');
            return found ? String(found) : null;
        };

        const buildWorkflowPutBody = (currentWorkflow: any, settings: any): any => {
            const allowedFields = ['name', 'nodes', 'connections', 'settings', 'staticData', 'pinData', 'meta'];
            const updatedWorkflow: any = {};
            for (const field of allowedFields) {
                if (currentWorkflow?.[field] !== undefined && currentWorkflow?.[field] !== null) {
                    updatedWorkflow[field] = currentWorkflow[field];
                }
            }
            updatedWorkflow.settings = settings;
            if (updatedWorkflow.settings) delete updatedWorkflow.settings.availableInMCP;
            return updatedWorkflow;
        };

        const extractDiagnostics = (execution: any) => {
            const resultData =
                execution?.data?.resultData ||
                execution?.data?.data?.resultData ||
                execution?.resultData ||
                undefined;

            const lastNodeExecuted = resultData?.lastNodeExecuted ?? execution?.lastNodeExecuted;
            const err = resultData?.error ?? execution?.error ?? null;
            const stack = err?.stack ?? err?.stackTrace ?? null;

            const nodeName = err?.node?.name ?? err?.node?.node ?? err?.node ?? err?.nodeName ?? null;
            const nodeType = err?.node?.type ?? err?.nodeType ?? null;

            const status = execution?.status ?? null;
            const finished = execution?.finished ?? null;

            return {
                status,
                finished,
                lastNodeExecuted: lastNodeExecuted ?? null,
                node: nodeName || nodeType ? { name: nodeName, type: nodeType } : null,
                error: err,
                stack,
            };
        };

        try {
            if (ensureSaveData) {
                const current = await n8nRequest('GET', `/api/v1/workflows/${workflowId}`);
                if (current.status !== 200) {
                    res.json({ status: current.status, data: current.data, error: 'Failed to fetch workflow for diagnostics' });
                    return;
                }

                originalSettings = current.data?.settings || {};
                const patchedSettings = {
                    ...originalSettings,
                    saveManualExecutions: true,
                    saveDataErrorExecution: 'all',
                    saveExecutionProgress: true,
                };

                const putBody = buildWorkflowPutBody(current.data, patchedSettings);
                const updated = await n8nRequest('PUT', `/api/v1/workflows/${workflowId}`, putBody);
                if (updated.status !== 200) {
                    warnings.push('Failed to update workflow settings for diagnostics. Continuing without forcing execution-data saving.');
                } else {
                    settingsPatched = true;
                }
            }

            const runResult = await n8nRequest('POST', `/api/v1/workflows/${workflowId}/run`, data || {});
            if (runResult.status !== 200 && runResult.status !== 201) {
                res.json({ status: runResult.status, data: runResult.data, error: 'Failed to start workflow execution' });
                return;
            }

            const executionId = extractExecutionId(runResult.data);
            if (!executionId) {
                res.json({ status: 500, data: runResult.data, error: 'Execution started but could not determine executionId from response' });
                return;
            }

            if (!wait) {
                res.json({
                    status: 200,
                    data: {
                        workflowId: String(workflowId),
                        executionId,
                        diagnostics: null,
                        upstream: {
                            runStatus: runResult.status,
                            executionReadStatus: null,
                        },
                        warnings,
                    },
                });
                return;
            }

            const timeout = typeof timeoutMs === 'number' ? timeoutMs : parseInt(String(timeoutMs), 10);
            const interval = typeof pollIntervalMs === 'number' ? pollIntervalMs : parseInt(String(pollIntervalMs), 10);
            const deadline = Date.now() + (Number.isFinite(timeout) ? timeout : 60000);

            let executionReadResult: { status: number; data: any } | null = null;
            if (wait) {
                let finishedByDeadline = false;
                while (Date.now() < deadline) {
                    const attemptWithData = await n8nRequest('GET', `/api/v1/executions/${executionId}?includeData=true`);
                    executionReadResult = attemptWithData;

                    const exec = attemptWithData.data;
                    const finished =
                        exec?.finished === true ||
                        typeof exec?.stoppedAt === 'string' ||
                        exec?.status === 'success' ||
                        exec?.status === 'error' ||
                        exec?.status === 'canceled' ||
                        exec?.status === 'crashed';

                    if (attemptWithData.status === 200 && finished) {
                        finishedByDeadline = true;
                        break;
                    }
                    await sleep(Number.isFinite(interval) ? interval : 1000);
                }

                if (!finishedByDeadline) {
                    warnings.push('Timed out waiting for execution to finish. Returning latest execution snapshot.');
                }
            }

            if (!executionReadResult) {
                executionReadResult = await n8nRequest('GET', `/api/v1/executions/${executionId}?includeData=true`);
            }
            if (executionReadResult.status !== 200) {
                const fallback = await n8nRequest('GET', `/api/v1/executions/${executionId}`);
                executionReadResult = fallback;
            }

            const execution = executionReadResult.status === 200 ? executionReadResult.data : null;
            const diagnostics = execution ? extractDiagnostics(execution) : null;

            const out: any = {
                workflowId: String(workflowId),
                executionId,
                diagnostics,
                upstream: {
                    runStatus: runResult.status,
                    executionReadStatus: executionReadResult.status,
                },
                warnings,
            };

            if (includeExecution) out.execution = execution;

            res.json({ status: 200, data: out });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        } finally {
            if (ensureSaveData && restoreSettings && settingsPatched && originalSettings) {
                try {
                    const current = await n8nRequest('GET', `/api/v1/workflows/${workflowId}`);
                    if (current.status === 200) {
                        const restoreBody = buildWorkflowPutBody(current.data, originalSettings);
                        await n8nRequest('PUT', `/api/v1/workflows/${workflowId}`, restoreBody);
                    }
                } catch {
                    // ignore restore failures
                }
            }
        }
    });

    // ===== CREDENTIAL API =====
    app.post('/api/n8n/credential_list', async (_req: Request, res: Response) => {
        try {
            const v1Attempt = await n8nRequest('GET', '/api/v1/credentials');
            if (v1Attempt.status === 200) {
                res.json(v1Attempt);
                return;
            }

            if (v1Attempt.status === 404 || v1Attempt.status === 405) {
                const restAttempt = await n8nRequest('GET', '/rest/credentials');
                if (restAttempt.status === 200) {
                    res.json(restAttempt);
                    return;
                }
            }

            res.json({
                status: 501,
                data: {
                    message: 'Credential listing is not supported by the n8n Public API on this instance. Enable an auth mode compatible with /rest endpoints or use UI for credential management.',
                    upstreamStatus: v1Attempt.status,
                    upstreamResponse: v1Attempt.data,
                },
            });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/credential_create', async (req: Request, res: Response) => {
        try {
            const { name, type, data } = req.body;
            const result = await n8nRequest('POST', '/api/v1/credentials', { name, type, data });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/credential_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/credentials/${req.body.credentialId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/credential_move', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PUT', `/api/v1/credentials/${req.body.credentialId}/transfer`, {
                destinationProjectId: req.body.destinationProjectId,
            });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== TAG API =====
    app.post('/api/n8n/tag_list', async (_req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', '/api/v1/tags');
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/tag_read', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', `/api/v1/tags/${req.body.tagId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/tag_create', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', '/api/v1/tags', { name: req.body.name });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/tag_update', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PATCH', `/api/v1/tags/${req.body.tagId}`, { name: req.body.name });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/tag_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/tags/${req.body.tagId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== WORKFLOW TAGS API =====
    app.post('/api/n8n/workflowtags_list', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', `/api/v1/workflows/${req.body.workflowId}/tags`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/workflowtags_update', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PUT', `/api/v1/workflows/${req.body.workflowId}/tags`, req.body.tagIds);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== VARIABLE API =====
    app.post('/api/n8n/variable_list', async (_req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', '/api/v1/variables');
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/variable_create', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', '/api/v1/variables', { key: req.body.key, value: req.body.value });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/variable_update', async (req: Request, res: Response) => {
        try {
            const { variableId, key, value } = req.body;
            const updates: any = {};
            if (key !== undefined) updates.key = key;
            if (value !== undefined) updates.value = value;
            const result = await n8nRequest('PATCH', `/api/v1/variables/${variableId}`, updates);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/variable_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/variables/${req.body.variableId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== USER API =====
    app.post('/api/n8n/user_list', async (req: Request, res: Response) => {
        try {
            let url = '/api/v1/users';
            if (req.body.includeRole) url += '?includeRole=true';
            const result = await n8nRequest('GET', url);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/user_read', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', `/api/v1/users/${req.body.userId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/user_create', async (req: Request, res: Response) => {
        try {
            const { email, firstName, lastName, role } = req.body;
            const result = await n8nRequest('POST', '/api/v1/users', { email, firstName, lastName, role });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/user_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/users/${req.body.userId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/user_changeRole', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PATCH', `/api/v1/users/${req.body.userId}/role`, { newRoleName: req.body.role });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/user_enforceMfa', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PATCH', `/api/v1/users/${req.body.userId}/settings`, { mfaEnabled: req.body.enabled });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== PROJECT API =====
    app.post('/api/n8n/project_list', async (_req: Request, res: Response) => {
        try {
            const result = await n8nRequest('GET', '/api/v1/projects');
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/project_create', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', '/api/v1/projects', { name: req.body.name });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/project_update', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('PATCH', `/api/v1/projects/${req.body.projectId}`, { name: req.body.name });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/n8n/project_delete', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('DELETE', `/api/v1/projects/${req.body.projectId}`);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== SOURCE CONTROL API =====
    app.post('/api/n8n/sourcecontrol_pull', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', '/api/v1/source-control/pull', { force: req.body.force || false });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== SECURITY AUDIT API =====
    app.post('/api/n8n/securityaudit_generate', async (req: Request, res: Response) => {
        try {
            const result = await n8nRequest('POST', '/api/v1/audit', { categories: req.body.categories });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // ===== MCP Parity: Local builder/state endpoints =====
    // Initialize/reset workflow state
    app.post('/api/mcp/init_workflow', async (_req: Request, res: Response) => {
        const multi = loadMultiState();
        multi.workflows[multi.current] = { nodes: [], connections: {} };
        saveMultiState(multi);
        // legacy single-state
        fs.writeFileSync(SINGLE_STATE_FILE, JSON.stringify({ nodes: [], connections: {} }, null, 2));
        res.json({ status: 200, data: { ok: true } });
    });

    // Load workflow from n8n to state
    app.post('/api/mcp/load_workflow_to_state', async (req: Request, res: Response) => {
        try {
            const { workflowId, slotName } = req.body;
            if (!workflowId) {
                res.json({ status: 400, error: 'workflowId is required' });
                return;
            }

            const current = await n8nRequest('GET', `/api/v1/workflows/${workflowId}`);
            if (current.status !== 200) {
                res.json({ status: current.status, data: current.data, error: 'Failed to fetch workflow' });
                return;
            }

            const wf = current.data;
            const nodes = wf.nodes || [];
            const connections = wf.connections || {};

            const multi = loadMultiState();
            const slot = slotName || multi.current;
            multi.workflows[slot] = { nodes, connections };
            saveMultiState(multi);
            fs.writeFileSync(SINGLE_STATE_FILE, JSON.stringify({ nodes, connections }, null, 2));

            res.json({ status: 200, data: { ok: true, nodeCount: nodes.length, connectionCount: Object.keys(connections).length } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Add nodes batch
    app.post('/api/mcp/add_nodes_batch', async (req: Request, res: Response) => {
        try {
            const nodes = req.body.nodes || [];
            if (!Array.isArray(nodes)) {
                res.json({ status: 400, error: 'nodes must be an array' });
                return;
            }
            const state = loadState();
            const schema = await getNodeSchema();
            const added: string[] = [];
            const errors: string[] = [];
            for (const nodeSpec of nodes) {
                try {
                    const node = createNodeFromSchema(nodeSpec, schema);
                    state.nodes.push(node);
                    added.push(node.name);
                } catch (e: any) {
                    errors.push(e.message);
                }
            }
            saveState(state);
            res.json({ status: 200, data: { addedCount: added.length, added, errors } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // List nodes
    app.post('/api/mcp/list_nodes', async (req: Request, res: Response) => {
        try {
            const state = loadState();
            const nodes = state.nodes.map((n: any) => ({
                name: n.name,
                type: n.type,
                disabled: n.disabled,
                notes: n.notes
            }));
            res.json({ status: 200, data: nodes });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Remove node
    app.post('/api/mcp/remove_node', async (req: Request, res: Response) => {
        try {
            const { nodeName } = req.body;
            const state = loadState();
            const nodeIndex = state.nodes.findIndex((n: any) => n.name === nodeName);
            if (nodeIndex === -1) {
                res.json({ status: 404, error: `Node not found: ${nodeName}` });
                return;
            }
            state.nodes.splice(nodeIndex, 1);
            if (state.connections[nodeName]) delete state.connections[nodeName];
            for (const key of Object.keys(state.connections)) {
                for (const outType of Object.keys(state.connections[key])) {
                    state.connections[key][outType] = state.connections[key][outType].filter(
                        (conn: any) => conn.node !== nodeName
                    );
                }
            }
            saveState(state);
            res.json({ status: 200, data: { removed: nodeName } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Remove nodes batch
    app.post('/api/mcp/remove_nodes_batch', async (req: Request, res: Response) => {
        try {
            const { nodeNames } = req.body;
            if (!Array.isArray(nodeNames)) {
                res.json({ status: 400, error: 'nodeNames must be an array' });
                return;
            }
            const state = loadState();
            const removed: string[] = [];
            for (const name of nodeNames) {
                const idx = state.nodes.findIndex((n: any) => n.name === name);
                if (idx !== -1) {
                    state.nodes.splice(idx, 1);
                    removed.push(name);
                    if (state.connections[name]) delete state.connections[name];
                    for (const key of Object.keys(state.connections)) {
                        for (const outType of Object.keys(state.connections[key])) {
                            state.connections[key][outType] = state.connections[key][outType].filter(
                                (conn: any) => conn.node !== name
                            );
                        }
                    }
                }
            }
            saveState(state);
            res.json({ status: 200, data: { removedCount: removed.length, removed } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Disconnect nodes
    app.post('/api/mcp/disconnect_nodes', async (req: Request, res: Response) => {
        try {
            const { from, to, outputIndex = 0, inputIndex } = req.body;
            const state = loadState();
            let found = false;

            if (state.connections[from]) {
                for (const outType of Object.keys(state.connections[from])) {
                    if (!state.connections[from][outType][outputIndex]) continue;
                    const prevLen = state.connections[from][outType][outputIndex].length;
                    state.connections[from][outType][outputIndex] = state.connections[from][outType][outputIndex].filter((c: any) => {
                        const matchNode = c.node === to;
                        const matchInput = typeof inputIndex === 'number' ? c.index === inputIndex : true;
                        return !(matchNode && matchInput);
                    });
                    if (state.connections[from][outType][outputIndex].length < prevLen) found = true;
                }
            }

            saveState(state);
            res.json({ status: 200, data: { disconnected: found } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Disconnect all from node
    app.post('/api/mcp/disconnect_all_from_node', async (req: Request, res: Response) => {
        try {
            const { nodeName } = req.body;
            const state = loadState();
            let count = 0;
            // Remove outgoing
            if (state.connections[nodeName]) {
                count += Object.values(state.connections[nodeName]).flat(2).length;
                delete state.connections[nodeName];
            }
            // Remove incoming
            for (const key of Object.keys(state.connections)) {
                for (const outType of Object.keys(state.connections[key])) {
                    state.connections[key][outType].forEach((arr: any[]) => {
                        const initial = arr.length;
                        for (let i = arr.length - 1; i >= 0; i--) {
                            if (arr[i].node === nodeName) {
                                arr.splice(i, 1);
                                count++;
                            }
                        }
                    });
                }
            }
            saveState(state);
            res.json({ status: 200, data: { disconnectedCount: count } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Save workflow to file
    app.post('/api/mcp/save_workflow', async (req: Request, res: Response) => {
        try {
            const { filename } = req.body;
            const state = loadState();
            fs.writeFileSync(filename, JSON.stringify(state, null, 2));
            res.json({ status: 200, data: { saved: true, path: filename } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Alias for creation
    app.post('/api/mcp/create_workflow_from_state', async (req: Request, res: Response) => {
        // Forward to save_current_state_as_workflow logic
        // We can just call the handler if we refactored, but here we will proxy via local request or duplicate logic?
        // Duplicating logic is safest given structure
        try {
            const { name } = req.body || {};
            const st = loadState();
            const schema = await getNodeSchema();
            const allNodes: any[] = (st.nodes || []);
            const sanitizedNodes = allNodes.map((n: any) => {
                const nodeSchema = schema.find((s: any) => s.name === n.type);
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
                return out;
            });

            // Sanitize connections
            const sanitizedConnections: Record<string, any> = {};
            for (const [srcNode, outputs] of Object.entries(st.connections || {})) {
                if (!outputs || typeof outputs !== 'object') continue;
                sanitizedConnections[srcNode] = {};
                for (const [outputType, connArrays] of Object.entries(outputs as any)) {
                    if (!Array.isArray(connArrays)) continue;
                    sanitizedConnections[srcNode][outputType] = connArrays.map((arr: any) => {
                        if (!Array.isArray(arr)) return [];
                        return arr.map((conn: any) => ({
                            node: conn.node,
                            type: conn.type,
                            index: typeof conn.index === 'number' ? conn.index : 0,
                        }));
                    });
                }
            }

            const result = await n8nRequest('POST', '/api/v1/workflows', {
                name: name || 'Workflow',
                nodes: sanitizedNodes,
                connections: sanitizedConnections,
                settings: {},
            });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });


    // Connect nodes batch
    app.post('/api/mcp/connect_nodes_batch', async (req: Request, res: Response) => {
        try {
            const connections = req.body.connections || [];
            if (!Array.isArray(connections)) {
                res.json({ status: 400, error: 'connections must be an array' });
                return;
            }
            const state = loadState();
            const schema = await getNodeSchema();
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

                const fromDef = getSchemaDefForNode(schema, state, from);
                const toDef = getSchemaDefForNode(schema, state, to);

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
                        connected.push(`${src}->${dst}`);
                        continue;
                    }
                    // fall through to allow main->main only if no AI wiring exists
                }

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
                    connected.push(`${from}->${to}`);
                    continue;
                }

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
                connected.push(`${src}->${dst}`);
            }
            saveState(state);
            res.json({ status: 200, data: { connectedCount: connected.length, connected, errors } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Configure nodes batch
    app.post('/api/mcp/configure_nodes_batch', async (req: Request, res: Response) => {
        try {
            const configurations = req.body.configurations || [];
            if (!Array.isArray(configurations)) {
                res.json({ status: 400, error: 'configurations must be an array' });
                return;
            }
            const state = loadState();
            const schema = await getNodeSchema();
            const configured: string[] = [];
            const errors: string[] = [];
            for (const c of configurations) {
                const { nodeName, parameters } = c || {};
                if (!nodeName) { errors.push('nodeName is required'); continue; }
                const node = state.nodes.find(n => n.name === nodeName);
                if (!node) { errors.push(`Node not found: ${nodeName}`); continue; }
                // Sanitize parameters against node schema
                const def = schema.find((n: any) => n.name === node.type);
                const tv = resolveTypeVersion(def, node.typeVersion);
                node.parameters = { ...node.parameters, ...sanitizeParameters(def, parameters || {}, tv) };
                configured.push(nodeName);
            }
            saveState(state);
            res.json({ status: 200, data: { configuredCount: configured.length, configured, errors } });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Get node schema used for parameter sanitization
    app.post('/api/mcp/get_schema', async (req: Request, res: Response) => {
        try {
            const refresh = !!(req.body && (req.body.refresh === true || req.body.refresh === 'true'));
            const schema = await getNodeSchema(refresh);
            res.json({ status: 200, data: schema, meta: NODE_SCHEMA_META });
        } catch (e: any) {
            res.json({ status: 500, error: e.message });
        }
    });

    app.get('/api/mcp/get_schema', async (req: Request, res: Response) => {
        try {
            const refresh = req.query && (req.query.refresh === 'true' || req.query.refresh === '1');
            const schema = await getNodeSchema(!!refresh);
            const body = { status: 200, data: schema, meta: NODE_SCHEMA_META };

            const download = req.query && (req.query.download === 'true' || req.query.download === '1');
            if (download) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.setHeader('Content-Disposition', 'attachment; filename="node-schema.json"');
                res.end(JSON.stringify(body));
                return;
            }

            res.json(body);
        } catch (e: any) {
            res.json({ status: 500, error: e.message });
        }
    });

    // Create a workflow in n8n from current middleware state
    app.post('/api/mcp/save_current_state_as_workflow', async (req: Request, res: Response) => {
        try {
            const { name } = req.body || {};
            const st = loadState();
            const schema = await getNodeSchema();
            const allNodes: any[] = (st.nodes || []);
            const sanitizedNodes = allNodes.map((n: any) => {
                const nodeSchema = schema.find((s: any) => s.name === n.type);
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
                return out;
            });

            // Sanitize connections: only keep allowed properties (node, type, index)
            const sanitizedConnections: Record<string, any> = {};
            for (const [srcNode, outputs] of Object.entries(st.connections || {})) {
                if (!outputs || typeof outputs !== 'object') continue;
                sanitizedConnections[srcNode] = {};
                for (const [outputType, connArrays] of Object.entries(outputs as any)) {
                    if (!Array.isArray(connArrays)) continue;
                    sanitizedConnections[srcNode][outputType] = connArrays.map((arr: any) => {
                        if (!Array.isArray(arr)) return [];
                        return arr.map((conn: any) => ({
                            node: conn.node,
                            type: conn.type,
                            index: typeof conn.index === 'number' ? conn.index : 0,
                        }));
                    });
                }
            }

            const result = await n8nRequest('POST', '/api/v1/workflows', {
                name: name || 'Workflow',
                nodes: sanitizedNodes,
                connections: sanitizedConnections,
                settings: {},
            });
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/mcp/workflow_update_from_state', async (req: Request, res: Response) => {
        try {
            const { workflowId, slotName, name } = req.body || {};
            if (!workflowId) {
                res.json({ status: 400, error: 'workflowId is required' });
                return;
            }

            const multi = loadMultiState();
            const slot = slotName || multi.current;
            const st = multi.workflows[slot] || { nodes: [], connections: {} };

            const schema = await getNodeSchema();
            const allNodes: any[] = (st.nodes || []);
            const sanitizedNodes = allNodes.map((n: any) => {
                const nodeSchema = schema.find((s: any) => s.name === n.type);
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
                return out;
            });

            const current = await n8nRequest('GET', `/api/v1/workflows/${workflowId}`);
            if (current.status !== 200) {
                res.json({ status: current.status, data: current.data, error: 'Failed to fetch workflow for update' });
                return;
            }

            const updatedWorkflow: any = {
                name: name || current.data?.name,
                nodes: sanitizedNodes,
                connections: st.connections || {},
                settings: current.data?.settings || {},
            };

            if (updatedWorkflow.settings && typeof updatedWorkflow.settings === 'object') {
                delete updatedWorkflow.settings.availableInMCP;
            }

            // Sanitize connections: only keep allowed properties (node, type, index)
            // This prevents "additional properties" errors from the n8n API
            const sanitizedConnections: Record<string, any> = {};
            for (const [srcNode, outputs] of Object.entries(st.connections || {})) {
                if (!outputs || typeof outputs !== 'object') continue;
                sanitizedConnections[srcNode] = {};
                for (const [outputType, connArrays] of Object.entries(outputs as any)) {
                    if (!Array.isArray(connArrays)) continue;
                    sanitizedConnections[srcNode][outputType] = connArrays.map((arr: any) => {
                        if (!Array.isArray(arr)) return [];
                        return arr.map((conn: any) => ({
                            node: conn.node,
                            type: conn.type,
                            index: typeof conn.index === 'number' ? conn.index : 0,
                        }));
                    });
                }
            }
            updatedWorkflow.connections = sanitizedConnections;

            const result = await n8nRequest('PUT', `/api/v1/workflows/${workflowId}`, updatedWorkflow);
            res.json(result);
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    // Browser Action Hook (Ghost Pilot)
    app.post('/api/browser/action', async (req: Request, res: Response) => {
        if (!browserActionHandler) {
            res.status(503).json({ error: 'Browser automation not initialized (Ghost Pilot disabled)' });
            return;
        }
        try {
            const result = await browserActionHandler(req.body);
            res.json({ status: 200, data: result });
        } catch (e: any) {
            res.status(500).json({ error: e.message });
        }
    });

    return app;
}

let server: http.Server | null = null;

/**
 * Start the API server
 */

export function startApiServer(store: any, onBrowserAction?: (action: any) => Promise<any>): Promise<void> {
    configStore = store;
    browserActionHandler = onBrowserAction || null;
    const app = createApp();

    return new Promise((resolve) => {
        // SECURITY: Bind to 127.0.0.1 (localhost) ONLY
        // This prevents external network access - the server cannot be reached from other machines
        // Only local processes on this machine can connect
        const LOCALHOST = '127.0.0.1';

        server = app.listen(API_PORT, LOCALHOST, () => {
            console.log(`[Middleware] API server running on http://${LOCALHOST}:${API_PORT} (localhost only)`);
            console.log(`[Middleware] Health check: http://${LOCALHOST}:${API_PORT}/api/health`);
            console.log(`[Middleware] SECURITY: External network access is blocked`);
            resolve();
        });
    });
}

/**
 * Stop the API server
 */
export function stopApiServer(): Promise<void> {
    return new Promise((resolve) => {
        if (server) {
            server.close(() => {
                console.log('[Middleware] API server stopped');
                server = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

export { API_PORT };
