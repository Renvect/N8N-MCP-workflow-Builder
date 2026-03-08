#!/usr/bin/env node
/**
 * N8N CLI - Command line interface for n8n middleware
 * Compiled and distributed with the Electron app
 * 
 * Usage:
 *   n8n-cli workflow list
 *   n8n-cli workflow run --id <id>
 *   n8n-cli execution list --status error
 *   n8n-cli health
 */

import { Command } from 'commander';
import * as http from 'http';
import * as fs from 'fs';

const MIDDLEWARE_URL = process.env.N8N_MIDDLEWARE_URL || 'http://127.0.0.1:3456';
const REQUEST_TIMEOUT_MS = parseInt(process.env.N8N_MIDDLEWARE_TIMEOUT_MS || '60000', 10);

// Simple HTTP client using Node built-in http module
async function apiCall(endpoint: string, body: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const url = new URL(endpoint, MIDDLEWARE_URL);

        const req = http.request({
            hostname: url.hostname,
            port: parseInt(url.port) || 3456,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseData));
                } catch {
                    resolve(responseData);
                }
            });
        });

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
        });

        req.on('error', (e) => {
            reject(new Error(`Middleware not reachable: ${e.message}`));
        });

        req.write(data);
        req.end();
    });
}

async function apiGet(endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, MIDDLEWARE_URL);

        const req = http.get({
            hostname: url.hostname,
            port: parseInt(url.port) || 3456,
            path: url.pathname,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    resolve(data);
                }
            });
        });

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
        });

        req.on('error', (e) => {
            reject(new Error(`Middleware not reachable: ${e.message}`));
        });
    });
}

async function apiCallStream(endpoint: string, body: any, writer: NodeJS.WritableStream): Promise<void> {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const url = new URL(endpoint, MIDDLEWARE_URL);

        const req = http.request({
            hostname: url.hostname,
            port: parseInt(url.port) || 3456,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            res.on('data', (chunk) => {
                writer.write(chunk);
            });
            res.on('end', () => {
                resolve();
            });
        });

        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.destroy(new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms`));
        });

        req.on('error', (e) => {
            reject(new Error(`Middleware not reachable: ${e.message}`));
        });

        req.write(data);
        req.end();
    });
}

async function readStdin(): Promise<string> {
    return await new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
            data += chunk;
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}

async function parseJsonInput(value: unknown, argName: string): Promise<any> {
    let raw = String(value ?? '').trim();

    if (raw === '-') {
        if (process.stdin.isTTY) {
            throw new Error(`No stdin detected for ${argName}. Pipe JSON into stdin or pass JSON inline.`);
        }
        raw = (await readStdin()).trim();
    }

    if (!raw) {
        throw new Error(`Missing JSON for ${argName}`);
    }

    const attempts: string[] = [raw];
    const deEscaped = raw.replace(/\\"/g, '"');
    if (deEscaped !== raw) attempts.push(deEscaped);

    for (const attempt of attempts) {
        try {
            const parsed = JSON.parse(attempt);
            if (typeof parsed === 'string') {
                try {
                    return JSON.parse(parsed);
                } catch {
                    return parsed;
                }
            }
            return parsed;
        } catch {
        }
    }

    throw new Error(`Invalid JSON for ${argName}`);
}

function output(data: any) {
    console.log(JSON.stringify(data, null, 2));
}

function handleError(e: any) {
    console.error('Error:', e.message || e);
    process.exit(1);
}

const program = new Command();

program
    .name('n8n-cli')
    .description('CLI for n8n middleware - manages workflows, executions, and more')
    .version('1.0.0');

// ===== WORKFLOW COMMANDS =====
const workflow = program.command('workflow').description('Manage workflows');

workflow
    .command('list')
    .description('List all workflows')
    .option('--active', 'Only active workflows')
    .option('--tags <tags>', 'Filter by tag IDs (comma-separated)')
    .option('--project <projectId>', 'Filter by project ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_list', {
                active: options.active,
                tags: options.tags,
                projectId: options.project
            });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('read')
    .description('Get workflow details')
    .requiredOption('--id <id>', 'Workflow ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_read', { workflowId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('create')
    .description('Create workflow from JSON file or inline')
    .requiredOption('--name <name>', 'Workflow name')
    .option('--file <file>', 'JSON file with nodes/connections')
    .option('--nodes <json>', 'Nodes as JSON string')
    .option('--connections <json>', 'Connections as JSON string')
    .action(async (options) => {
        try {
            let nodes: any[] = [];
            let connections: any = {};

            if (options.file) {
                const fs = await import('fs');
                const content = JSON.parse(fs.readFileSync(options.file, 'utf8'));
                nodes = content.nodes || [];
                connections = content.connections || {};
            } else {
                if (options.nodes) nodes = await parseJsonInput(options.nodes, 'nodes');
                if (options.connections) connections = await parseJsonInput(options.connections, 'connections');
            }

            const result = await apiCall('/api/mcp/workflow_create', {
                name: options.name,
                nodes,
                connections
            });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('update')
    .description('Update a workflow')
    .requiredOption('--id <id>', 'Workflow ID')
    .option('--name <name>', 'New workflow name')
    .option('--file <file>', 'JSON file with updates')
    .action(async (options) => {
        try {
            let updates: any = { workflowId: options.id };

            if (options.name) updates.name = options.name;
            if (options.file) {
                const fs = await import('fs');
                const content = JSON.parse(fs.readFileSync(options.file, 'utf8'));
                updates = { ...updates, ...content };
            }

            const result = await apiCall('/api/n8n/workflow_update', updates);
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('run')
    .description('Execute a workflow')
    .requiredOption('--id <id>', 'Workflow ID')
    .option('--data <json>', 'Input data as JSON string', '{}')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/execute_workflow', {
                workflowId: options.id,
                data: await parseJsonInput(options.data, 'data')
            });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('diagnose')
    .description('Run a workflow and return detailed diagnostics (polls until finished, fetches execution with includeData=true)')
    .requiredOption('--id <id>', 'Workflow ID')
    .option('--data <json>', 'Input data as JSON string (use - for stdin)', '{}')
    .option('--no-wait', 'Do not wait for the execution to finish (returns executionId only)')
    .option('--timeout <ms>', 'Max time to wait for completion (ms)', '60000')
    .option('--interval <ms>', 'Polling interval (ms)', '1000')
    .option('--no-ensure-save-data', 'Do not attempt to modify workflow settings to ensure execution data is saved')
    .option('--no-restore-settings', 'Do not restore original workflow settings after diagnostics')
    .option('--include-execution', 'Include the raw execution object in output')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_diagnose', {
                workflowId: options.id,
                data: await parseJsonInput(options.data, 'data'),
                wait: options.wait,
                timeoutMs: parseInt(options.timeout, 10),
                pollIntervalMs: parseInt(options.interval, 10),
                ensureSaveData: options.ensureSaveData,
                restoreSettings: options.restoreSettings,
                includeExecution: options.includeExecution,
            });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('activate')
    .description('Activate a workflow')
    .requiredOption('--id <id>', 'Workflow ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_activate', { workflowId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('deactivate')
    .description('Deactivate a workflow')
    .requiredOption('--id <id>', 'Workflow ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_deactivate', { workflowId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('delete')
    .description('Delete a workflow')
    .requiredOption('--id <id>', 'Workflow ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_delete', { workflowId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

workflow
    .command('move')
    .description('Move workflow to another project')
    .requiredOption('--id <id>', 'Workflow ID')
    .requiredOption('--project <projectId>', 'Destination project ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflow_move', {
                workflowId: options.id,
                destinationProjectId: options.project
            });
            output(result);
        } catch (e) { handleError(e); }
    });

// MCP parity: Stateful builder commands
const builder = program.command('builder').description('Stateful workflow builder (MCP parity)');

builder
    .command('init')
    .description('Initialize/reset in-memory workflow state')
    .action(async () => {
        try {
            const result = await apiCall('/api/mcp/init_workflow', {});
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('add-batch')
    .description('Add multiple nodes to the in-memory state')
    .requiredOption('--nodes <json>', 'Array of node specs JSON')
    .action(async (options) => {
        try {
            const nodes = await parseJsonInput(options.nodes, 'nodes');
            const result = await apiCall('/api/mcp/add_nodes_batch', { nodes });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('connect-batch')
    .description('Connect multiple node pairs')
    .requiredOption('--connections <json>', 'Array of connection specs JSON')
    .action(async (options) => {
        try {
            const connections = await parseJsonInput(options.connections, 'connections');
            const result = await apiCall('/api/mcp/connect_nodes_batch', { connections });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('configure-batch')
    .description('Configure multiple nodes parameters')
    .requiredOption('--configurations <json>', 'Array of configuration specs JSON')
    .action(async (options) => {
        try {
            const configurations = await parseJsonInput(options.configurations, 'configurations');
            const result = await apiCall('/api/mcp/configure_nodes_batch', { configurations });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('connect-subnode')
    .description('Connect a sub-node (e.g. AI Model/Tool) to a parent node')
    .requiredOption('--from <node>', 'Source node (Sub-node)')
    .requiredOption('--to <node>', 'Target node (Parent/Root node)')
    .option('--type <type>', 'Connection type (e.g. ai_languageModel, ai_tool). If omitted, server will infer from schema.')
    .option('--input-type <type>', 'Input type (overrides --type)')
    .option('--output-type <type>', 'Output type (overrides --type)')
    .option('--input <n>', 'Input index', '0')
    .option('--output <n>', 'Output index', '0')
    .action(async (options) => {
        try {
            const connection: any = {
                from: options.from,
                to: options.to,
                outputIndex: parseInt(options.output, 10),
                inputIndex: parseInt(options.input, 10),
            };

            const outputType = (typeof options.outputType === 'string' && options.outputType.trim().length)
                ? options.outputType.trim()
                : ((typeof options.type === 'string' && options.type.trim().length) ? options.type.trim() : undefined);
            const inputType = (typeof options.inputType === 'string' && options.inputType.trim().length)
                ? options.inputType.trim()
                : ((typeof options.type === 'string' && options.type.trim().length) ? options.type.trim() : undefined);

            if (outputType) connection.outputType = outputType;
            if (inputType) connection.inputType = inputType;

            const result = await apiCall('/api/mcp/connect_nodes_batch', { connections: [connection] });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('remove')
    .description('Remove a node by name')
    .requiredOption('--name <nodeName>', 'Node name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/remove_node', { nodeName: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('remove-batch')
    .description('Remove multiple nodes by names')
    .requiredOption('--names <list>', 'Comma-separated names or JSON array')
    .action(async (options) => {
        try {
            let nodeNames: string[];
            const raw = String(options.names || '').trim();
            if (raw.startsWith('[')) nodeNames = await parseJsonInput(raw, 'names');
            else nodeNames = raw.split(',').map((s) => s.trim()).filter(Boolean);
            const result = await apiCall('/api/mcp/remove_nodes_batch', { nodeNames });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('disconnect')
    .description('Disconnect a specific connection')
    .requiredOption('--from <node>', 'Source node name')
    .requiredOption('--to <node>', 'Target node name')
    .option('--output <n>', 'Source output index', '0')
    .option('--input <n>', 'Target input index', '0')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/disconnect_nodes', {
                from: options.from,
                to: options.to,
                outputIndex: parseInt(options.output),
                inputIndex: parseInt(options.input),
            });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('disconnect-all-from')
    .description('Disconnect all connections to/from a node')
    .requiredOption('--name <nodeName>', 'Node name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/disconnect_all_from_node', { nodeName: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('list-nodes')
    .description('List nodes in current state')
    .action(async () => {
        try {
            const result = await apiCall('/api/mcp/list_nodes', {});
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('save')
    .description('Save current in-memory workflow to file')
    .requiredOption('--file <path>', 'Output JSON path')
    .option('--name <name>', 'Workflow name', 'Workflow')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/save_workflow', { filename: options.file, name: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('create-from-state')
    .description('Create an n8n workflow from current state')
    .option('--name <name>', 'Workflow name', 'Workflow')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/create_workflow_from_state', { name: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('update-remote')
    .description('Update an existing n8n workflow from current/selected state slot')
    .requiredOption('--id <workflowId>', 'Workflow ID')
    .option('--slot <name>', 'State slot name (defaults to current)')
    .option('--name <name>', 'Override workflow name in n8n')
    .action(async (options) => {
        try {
            const payload: any = { workflowId: options.id };
            if (options.slot) payload.slotName = options.slot;
            if (options.name) payload.name = options.name;
            const result = await apiCall('/api/mcp/workflow_update_from_state', payload);
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('load')
    .description('Load existing n8n workflow into state')
    .requiredOption('--id <workflowId>', 'Workflow ID')
    .option('--slot <name>', 'State slot name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/load_workflow_to_state', { workflowId: options.id, slotName: options.slot });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('switch-slot')
    .description('Switch current state slot')
    .requiredOption('--slot <name>', 'Slot name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/mcp/switch_workflow_slot', { slotName: options.slot });
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('list-slots')
    .description('List available state slots')
    .action(async () => {
        try {
            const result = await apiCall('/api/mcp/list_workflow_slots', {});
            output(result);
        } catch (e) { handleError(e); }
    });

builder
    .command('get-schema')
    .description('Get node schema used by builder')
    .option('--out <file>', 'Write raw JSON response to a file (prevents console slowness)')
    .option('--refresh', 'Force refresh schema from n8n (bypass cache)')
    .action(async (options) => {
        try {
            const payload: any = {};
            if (options.refresh) payload.refresh = true;

            if (options.out) {
                const ws = fs.createWriteStream(options.out, { encoding: 'utf8' });
                await apiCallStream('/api/mcp/get_schema', payload, ws);
                ws.end();
                console.error(`Wrote schema response to ${options.out}`);
                return;
            }

            await apiCallStream('/api/mcp/get_schema', payload, process.stdout);
            if (process.stdout.isTTY) process.stdout.write('\n');
        } catch (e) { handleError(e); }
    });

builder
    .command('get-schema-detail')
    .description('Get details for a node type and optional property')
    .requiredOption('--node-type <name>', 'Node type name')
    .option('--property <prop>', 'Property name')
    .action(async (options) => {
        try {
            const payload: any = { nodeType: options.nodeType };
            if (options.property) payload.property = options.property;
            const result = await apiCall('/api/mcp/get_schema_detail', payload);
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== EXECUTION COMMANDS =====
const execution = program.command('execution').description('Manage executions');

execution
    .command('list')
    .description('List executions')
    .option('--workflow <id>', 'Filter by workflow ID')
    .option('--status <status>', 'Filter by status (success, error, waiting)')
    .option('--limit <n>', 'Max results', '20')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/execution_list', {
                workflowId: options.workflow,
                status: options.status,
                limit: parseInt(options.limit)
            });
            output(result);
        } catch (e) { handleError(e); }
    });

execution
    .command('read')
    .description('Get execution details')
    .requiredOption('--id <id>', 'Execution ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/execution_read', { executionId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

execution
    .command('retry')
    .description('Retry a failed execution')
    .requiredOption('--id <id>', 'Execution ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/execution_retry', { executionId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

execution
    .command('delete')
    .description('Delete an execution')
    .requiredOption('--id <id>', 'Execution ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/execution_delete', { executionId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== CREDENTIAL COMMANDS =====
const credential = program.command('credential').description('Manage credentials');

credential
    .command('list')
    .description('List all credentials')
    .action(async () => {
        try {
            const result = await apiCall('/api/n8n/credential_list');
            output(result);
        } catch (e) { handleError(e); }
    });

credential
    .command('create')
    .description('Create a credential')
    .requiredOption('--name <name>', 'Credential name')
    .requiredOption('--type <type>', 'Credential type (e.g., httpBasicAuth, slackApi)')
    .requiredOption('--data <json>', 'Credential data as JSON')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/credential_create', {
                name: options.name,
                type: options.type,
                data: await parseJsonInput(options.data, 'data')
            });
            output(result);
        } catch (e) { handleError(e); }
    });

credential
    .command('delete')
    .description('Delete a credential')
    .requiredOption('--id <id>', 'Credential ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/credential_delete', { credentialId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

credential
    .command('move')
    .description('Move credential to another project')
    .requiredOption('--id <id>', 'Credential ID')
    .requiredOption('--project <projectId>', 'Destination project ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/credential_move', {
                credentialId: options.id,
                destinationProjectId: options.project
            });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== TAG COMMANDS =====
const tag = program.command('tag').description('Manage tags');

tag
    .command('list')
    .description('List all tags')
    .action(async () => {
        try {
            const result = await apiCall('/api/n8n/tag_list');
            output(result);
        } catch (e) { handleError(e); }
    });

tag
    .command('create')
    .description('Create a tag')
    .requiredOption('--name <name>', 'Tag name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/tag_create', { name: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

tag
    .command('delete')
    .description('Delete a tag')
    .requiredOption('--id <id>', 'Tag ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/tag_delete', { tagId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

tag
    .command('read')
    .description('Get a tag by ID')
    .requiredOption('--id <id>', 'Tag ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/tag_read', { tagId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

tag
    .command('update')
    .description('Update a tag')
    .requiredOption('--id <id>', 'Tag ID')
    .requiredOption('--name <name>', 'New tag name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/tag_update', { tagId: options.id, name: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== WORKFLOW TAGS COMMANDS =====
const workflowtags = program.command('workflow-tags').description('Manage workflow tags');

workflowtags
    .command('list')
    .description('List tags for a workflow')
    .requiredOption('--workflow <id>', 'Workflow ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/workflowtags_list', { workflowId: options.workflow });
            output(result);
        } catch (e) { handleError(e); }
    });

workflowtags
    .command('update')
    .description('Update tags for a workflow')
    .requiredOption('--workflow <id>', 'Workflow ID')
    .requiredOption('--tags <ids>', 'Tag IDs (comma-separated)')
    .action(async (options) => {
        try {
            const tagIds = options.tags.split(',').map((t: string) => t.trim());
            const result = await apiCall('/api/n8n/workflowtags_update', {
                workflowId: options.workflow,
                tagIds
            });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== VARIABLE COMMANDS =====
const variable = program.command('variable').description('Manage variables');

variable
    .command('list')
    .description('List all variables')
    .action(async () => {
        try {
            const result = await apiCall('/api/n8n/variable_list');
            output(result);
        } catch (e) { handleError(e); }
    });

variable
    .command('create')
    .description('Create a variable')
    .requiredOption('--key <key>', 'Variable key')
    .requiredOption('--value <value>', 'Variable value')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/variable_create', {
                key: options.key,
                value: options.value
            });
            output(result);
        } catch (e) { handleError(e); }
    });

variable
    .command('delete')
    .description('Delete a variable')
    .requiredOption('--id <id>', 'Variable ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/variable_delete', { variableId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

variable
    .command('update')
    .description('Update a variable')
    .requiredOption('--id <id>', 'Variable ID')
    .option('--key <key>', 'New variable key')
    .option('--value <value>', 'New variable value')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/variable_update', {
                variableId: options.id,
                key: options.key,
                value: options.value
            });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== USER COMMANDS =====
const user = program.command('user').description('Manage users');

user
    .command('list')
    .description('List all users')
    .option('--include-role', 'Include role information')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/user_list', { includeRole: options.includeRole });
            output(result);
        } catch (e) { handleError(e); }
    });

user
    .command('read')
    .description('Get user details')
    .requiredOption('--id <id>', 'User ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/user_read', { userId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

user
    .command('create')
    .description('Create a new user')
    .requiredOption('--email <email>', 'User email')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--role <role>', 'Role (global:admin, global:member)')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/user_create', {
                email: options.email,
                firstName: options.firstName,
                lastName: options.lastName,
                role: options.role
            });
            output(result);
        } catch (e) { handleError(e); }
    });

user
    .command('delete')
    .description('Delete a user')
    .requiredOption('--id <id>', 'User ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/user_delete', { userId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

user
    .command('change-role')
    .description('Change user role')
    .requiredOption('--id <id>', 'User ID')
    .requiredOption('--role <role>', 'New role (global:admin, global:member)')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/user_changeRole', { userId: options.id, role: options.role });
            output(result);
        } catch (e) { handleError(e); }
    });

user
    .command('enforce-mfa')
    .description('Enforce MFA for a user')
    .requiredOption('--id <id>', 'User ID')
    .option('--enabled', 'Enable MFA (default: true)')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/user_enforceMfa', {
                userId: options.id,
                enabled: options.enabled !== false
            });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== PROJECT COMMANDS =====
const project = program.command('project').description('Manage projects');

project
    .command('list')
    .description('List all projects')
    .action(async () => {
        try {
            const result = await apiCall('/api/n8n/project_list');
            output(result);
        } catch (e) { handleError(e); }
    });

project
    .command('create')
    .description('Create a project')
    .requiredOption('--name <name>', 'Project name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/project_create', { name: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

project
    .command('update')
    .description('Update a project')
    .requiredOption('--id <id>', 'Project ID')
    .requiredOption('--name <name>', 'New project name')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/project_update', { projectId: options.id, name: options.name });
            output(result);
        } catch (e) { handleError(e); }
    });

project
    .command('delete')
    .description('Delete a project')
    .requiredOption('--id <id>', 'Project ID')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/project_delete', { projectId: options.id });
            output(result);
        } catch (e) { handleError(e); }
    });

// ===== UTILITY COMMANDS =====
program
    .command('health')
    .description('Check middleware health')
    .action(async () => {
        try {
            const result = await apiGet('/api/health');
            output(result);
        } catch (e) { handleError(e); }
    });

program
    .command('config')
    .description('Get current n8n configuration')
    .action(async () => {
        try {
            const result = await apiGet('/api/config');
            output(result);
        } catch (e) { handleError(e); }
    });

program
    .command('test-connection')
    .description('Test n8n connection')
    .action(async () => {
        try {
            const result = await apiCall('/api/n8n/test_connection');
            output(result);
        } catch (e) { handleError(e); }
    });

program
    .command('audit')
    .description('Generate security audit report')
    .option('--categories <cats>', 'Categories: credentials,nodes,instance (comma-separated)')
    .action(async (options) => {
        try {
            const categories = options.categories ? options.categories.split(',') : undefined;
            const result = await apiCall('/api/n8n/securityaudit_generate', { categories });
            output(result);
        } catch (e) { handleError(e); }
    });

program
    .command('source-control-pull')
    .description('Pull from source control')
    .option('--force', 'Force pull')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/n8n/sourcecontrol_pull', { force: options.force || false });
            output(result);
        } catch (e) { handleError(e); }
    });

const argv = (() => {
    const a = process.argv;
    const isCliScript = (v: unknown) => {
        if (typeof v !== 'string') return false;
        const s = v.toLowerCase();
        return s.endsWith('cli.js') || s.endsWith('cli.jsc');
    };

    const scriptIndex = a.findIndex((v, i) => i >= 1 && isCliScript(v));
    if (scriptIndex > 1) {
        return [a[0], a[scriptIndex], ...a.slice(scriptIndex + 1)];
    }

    return a;
})();

// ===== VISION COMMANDS (Ghost Pilot) =====
const vision = program.command('vision').description('Visual Agent commands (Ghost Pilot)');

vision
    .command('tree')
    .description('Get the semantic Accessibility Tree of the current page')
    .action(async () => {
        try {
            const result = await apiCall('/api/browser/action', { action: 'tree' });
            if (result.tree) output(result.tree);
            else output(result);
        } catch (e) { handleError(e); }
    });

vision
    .command('click')
    .description('Click an element by selector or coords')
    .argument('[selector]', 'CSS selector')
    .option('-x, --x <n>', 'X coordinate')
    .option('-y, --y <n>', 'Y coordinate')
    .action(async (selector, options) => {
        try {
            const payload: any = { action: 'click' };
            if (selector) payload.selector = selector;
            if (options.x && options.y) {
                payload.x = parseInt(options.x, 10);
                payload.y = parseInt(options.y, 10);
            }
            if (!payload.selector && (!payload.x || !payload.y)) {
                throw new Error('Must provide selector or --x --y');
            }
            const result = await apiCall('/api/browser/action', payload);
            output(result);
        } catch (e) { handleError(e); }
    });

vision
    .command('type')
    .description('Type text into the focused element')
    .argument('<text>', 'Text to type')
    .action(async (text) => {
        try {
            const result = await apiCall('/api/browser/action', { action: 'type', text });
            output(result);
        } catch (e) { handleError(e); }
    });

vision
    .command('eval')
    .description('Evaluate JavaScript in the browser')
    .argument('<expression>', 'JS expression')
    .action(async (expression) => {
        try {
            const result = await apiCall('/api/browser/action', { action: 'eval', text: expression });
            output(result);
        } catch (e) { handleError(e); }
    });

vision
    .command('screenshot')
    .description('Capture screenshot and save to file')
    .option('-o, --output <file>', 'Output file', 'screenshot.png')
    .action(async (options) => {
        try {
            const result = await apiCall('/api/browser/action', { action: 'screenshot' });
            if (result.data) {
                const fs = await import('fs');
                fs.writeFileSync(options.output, Buffer.from(result.data, 'base64'));
                console.log(`Saved screenshot to ${options.output}`);
            } else {
                output(result);
            }
        } catch (e) { handleError(e); }
    });

program.parse(argv);
