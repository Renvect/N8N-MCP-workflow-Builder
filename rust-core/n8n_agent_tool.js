/**
 * N8N Schema-Driven Agent Tool
 * 
 * This is a STRICT agent interface that prevents manual editing.
 * You can ONLY interact through commands that enforce schema validation.
 * 
 * Commands:
 *   node n8n_agent_tool.js init-workflow                   - Start fresh workflow
 *   node n8n_agent_tool.js add-node <type> <name> <json>   - Add node with config
 *   node n8n_agent_tool.js connect-nodes <from> <to>       - Connect nodes
 *   node n8n_agent_tool.js save-workflow <filename>        - Save to file
 *   node n8n_agent_tool.js get-options <type> <prop>       - Check valid options
 */

const fs = require('fs');
const crypto = require('crypto');

class N8nAgentTool {
    constructor() {
        this.schema = null;
        this.stateFile = './.agent_tool_state.json';
        this.workflowNodes = [];
        this.workflowConnections = {};
    }

    getNodeSchema(nodeType) {
        if (!this.schema) return null;
        return this.schema.find(n => n.name === nodeType) || null;
    }

    getAllowedTypeVersions(nodeSchema) {
        if (!nodeSchema) return [];
        const versions = [];
        if (Array.isArray(nodeSchema.version)) {
            versions.push(...nodeSchema.version.filter(v => typeof v === 'number'));
        } else if (typeof nodeSchema.version === 'number') {
            versions.push(nodeSchema.version);
        }
        if (typeof nodeSchema.defaultVersion === 'number') {
            versions.push(nodeSchema.defaultVersion);
        }
        return Array.from(new Set(versions));
    }

    resolveTypeVersion(nodeSchema, requestedTypeVersion) {
        const versions = this.getAllowedTypeVersions(nodeSchema);
        if (typeof requestedTypeVersion === 'number') {
            if (versions.length === 0) return requestedTypeVersion;
            if (versions.includes(requestedTypeVersion)) return requestedTypeVersion;
            const max = Math.max(...versions);
            return max;
        }

        if (typeof nodeSchema?.defaultVersion === 'number') return nodeSchema.defaultVersion;
        if (versions.length > 0) return Math.max(...versions);
        return 1;
    }

    isPlainObject(value) {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    getNestedValue(obj, path) {
        if (!obj || !path) return undefined;
        const parts = String(path).split('.').filter(Boolean);
        let current = obj;
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    }

    normalizeDisplayOptionKey(key) {
        if (!key) return '';
        const k = String(key).trim();
        if (!k) return '';
        if (k === '@version') return '@version';
        if (k.startsWith('/')) return k.slice(1).replace(/\//g, '.');
        return k;
    }

    matchesVersionCondition(entry, typeVersion) {
        if (typeof typeVersion !== 'number') return false;
        if (typeof entry === 'number') return typeVersion === entry;
        if (typeof entry === 'string') {
            const parsed = Number(entry);
            if (!Number.isNaN(parsed)) return typeVersion === parsed;
            return false;
        }
        if (entry && typeof entry === 'object') {
            const cnd = entry._cnd;
            if (!cnd || typeof cnd !== 'object') return false;

            const ops = ['gte', 'lte', 'gt', 'lt', 'eq', 'ne'];
            for (const op of ops) {
                if (cnd[op] === undefined) continue;
                const v = Number(cnd[op]);
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

    isPropertyVisible(propSchema, parameters, typeVersion) {
        const displayOptions = propSchema?.displayOptions;
        if (!displayOptions) return true;

        const evalConfig = { ...(parameters || {}), '@version': typeVersion };

        const checkShowHide = (rules, mode) => {
            if (!rules) return true;
            for (const [rawKey, allowed] of Object.entries(rules)) {
                const key = this.normalizeDisplayOptionKey(rawKey);
                if (!key) continue;
                const allowedArr = Array.isArray(allowed) ? allowed : [allowed];

                if (key === '@version') {
                    const ok = allowedArr.some(entry => this.matchesVersionCondition(entry, typeVersion));
                    if (mode === 'show' && !ok) return false;
                    if (mode === 'hide' && ok) return false;
                    continue;
                }

                const actual = this.getNestedValue(evalConfig, key);
                const matches = allowedArr.some(v => v === actual);
                if (mode === 'show' && !matches) return false;
                if (mode === 'hide' && matches) return false;
            }
            return true;
        };

        if (!checkShowHide(displayOptions.show, 'show')) return false;
        if (!checkShowHide(displayOptions.hide, 'hide')) return false;
        return true;
    }

    sanitizeParameters(nodeSchema, parameters, typeVersion) {
        const schemaProps = Array.isArray(nodeSchema?.properties) ? nodeSchema.properties : [];
        const propByName = new Map(schemaProps.map(p => [p.name, p]));
        const out = { ...(parameters || {}) };

        // Guard unknown fields (strip to match SGCA/NodeRegistry behavior)
        for (const key of Object.keys(out)) {
            if (!propByName.has(key)) {
                console.warn(`⚠️  Stripping unknown parameter '${key}' from ${nodeSchema?.name || 'node'} (typeVersion=${typeVersion})`);
                delete out[key];
            }
        }

        // Strip parameters that are not active/visible for this configuration
        for (const key of Object.keys(out)) {
            const propSchema = propByName.get(key);
            if (!propSchema) continue;
            if (!this.isPropertyVisible(propSchema, out, typeVersion)) {
                delete out[key];
            }
        }

        // Ensure structural shapes match schema (prevents import-time schema resolution errors)
        for (const propSchema of schemaProps) {
            const name = propSchema.name;
            if (!(name in out)) continue;
            if (!this.isPropertyVisible(propSchema, out, typeVersion)) continue;

            const t = String(propSchema.type || '').toLowerCase();
            const v = out[name];

            if ((t === 'collection' || t === 'fixedcollection') && v !== undefined && v !== null && !this.isPlainObject(v)) {
                out[name] = {};
            }

            if (t === 'multioptions' && v !== undefined && v !== null && !Array.isArray(v)) {
                out[name] = [v];
            }

            if (t === 'options' && Array.isArray(v)) {
                out[name] = v.length > 0 ? v[0] : undefined;
            }

            if (t === 'options' && propSchema.options && out[name] !== undefined) {
                const validValues = propSchema.options.map(o => o.value);
                if (!validValues.includes(out[name])) {
                    throw new Error(
                        `INVALID: Value '${out[name]}' not allowed for property '${name}'.\n` +
                        `Valid options: ${validValues.join(', ')}`
                    );
                }
            }
        }

        // Fill visible required fields with defaults / safe empty structures
        for (const propSchema of schemaProps) {
            const name = propSchema.name;
            const visible = this.isPropertyVisible(propSchema, out, typeVersion);
            if (!visible) continue;
            if (!propSchema.required) continue;
            if (out[name] !== undefined) continue;

            if (propSchema.default !== undefined) {
                out[name] = propSchema.default;
                continue;
            }

            const t = String(propSchema.type || '').toLowerCase();
            if (t === 'collection' || t === 'fixedcollection') {
                out[name] = {};
            }
            if (t === 'multioptions') {
                out[name] = [];
            }
        }

        return out;
    }

    loadState() {
        if (fs.existsSync(this.stateFile)) {
            try {
                const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
                this.workflowNodes = state.nodes || [];
                this.workflowConnections = state.connections || {};
            } catch (e) {
                console.error('Warning: Could not load state, starting fresh');
                this.workflowNodes = [];
                this.workflowConnections = {};
            }
        }
    }

    saveState() {
        fs.writeFileSync(this.stateFile, JSON.stringify({
            nodes: this.workflowNodes,
            connections: this.workflowConnections
        }, null, 2));
    }

    async init() {
        if (this.schema) return;

        // Load schema
        const schemaPath = './node-types-schema.json';
        if (!fs.existsSync(schemaPath)) {
            throw new Error('Schema not found. Run: node fetch-node-schema.js first');
        }
        this.schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

        // Load current workflow state
        this.loadState();
    }

    getNodeTypes(search = '') {
        const query = search.toLowerCase();
        return this.schema.filter(n =>
            !search ||
            n.name.toLowerCase().includes(query) ||
            (n.displayName && n.displayName.toLowerCase().includes(query))
        ).map(n => ({
            type: n.name,
            displayName: n.displayName,
            description: n.description,
            version: n.version
        }));
    }

    getNodeProperties(nodeType) {
        const nodeSchema = this.schema.find(n => n.name === nodeType);
        if (!nodeSchema) throw new Error(`Node type not found: ${nodeType}`);

        return nodeSchema.properties.map(p => ({
            name: p.name,
            displayName: p.displayName,
            type: p.type,
            required: p.required || false,
            default: p.default,
            description: p.description,
            hasOptions: !!p.options,
            optionCount: p.options ? p.options.length : 0
        }));
    }

    getPropertyOptions(nodeType, propertyName) {
        const nodeSchema = this.schema.find(n => n.name === nodeType);
        if (!nodeSchema) throw new Error(`Node type not found: ${nodeType}`);

        const property = nodeSchema.properties.find(p => p.name === propertyName);
        if (!property) throw new Error(`Property '${propertyName}' not found on ${nodeType}`);

        const result = {
            property: propertyName,
            type: property.type,
            required: property.required || false,
            default: property.default,
            description: property.description
        };

        if (property.options && Array.isArray(property.options)) {
            result.validOptions = property.options.map(opt => ({
                value: opt.value,
                name: opt.name,
                description: opt.description
            }));
        }
        return result;
    }

    createValidatedNode(nodeType, config) {
        const nodeSchema = this.getNodeSchema(nodeType);
        if (!nodeSchema) throw new Error(`Node type not found: ${nodeType}`);

        const { name, parameters = {}, position = [0, 0], credentials = {} } = config;

        const typeVersion = this.resolveTypeVersion(nodeSchema, config.typeVersion);

        const sanitizedParameters = this.sanitizeParameters(nodeSchema, parameters, typeVersion);

        const node = {
            parameters: sanitizedParameters,
            id: crypto.randomUUID(),
            name: name || nodeType.split('.').pop(),
            type: nodeType,
            typeVersion,
            position
        };

        if (Object.keys(credentials).length > 0) {
            node.credentials = credentials;
        }

        if (nodeType === 'n8n-nodes-base.webhook') {
            node.webhookId = crypto.randomBytes(4).toString('hex');
        }

        return node;
    }

    addNodeToWorkflow(nodeType, config) {
        const node = this.createValidatedNode(nodeType, config);
        this.workflowNodes.push(node);
        this.saveState();
        console.log(`✅ Added node: ${node.name} (${nodeType})`);
        return node;
    }

    connectNodes(fromNodeName, toNodeName, outputIndex = 0, inputIndex = 0) {
        const fromNode = this.workflowNodes.find(n => n.name === fromNodeName);
        const toNode = this.workflowNodes.find(n => n.name === toNodeName);

        if (!fromNode) throw new Error(`Source node not found: ${fromNodeName}`);
        if (!toNode) throw new Error(`Target node not found: ${toNodeName}`);

        if (!this.workflowConnections[fromNodeName]) {
            this.workflowConnections[fromNodeName] = { main: [] };
        }
        if (!this.workflowConnections[fromNodeName].main[outputIndex]) {
            this.workflowConnections[fromNodeName].main[outputIndex] = [];
        }

        this.workflowConnections[fromNodeName].main[outputIndex].push({
            node: toNodeName,
            type: 'main',
            index: inputIndex
        });

        this.saveState();
        console.log(`✅ Connected: ${fromNodeName} → ${toNodeName}`);
    }

    resetWorkflow() {
        this.workflowNodes = [];
        this.workflowConnections = {};
        this.saveState();
        console.log('✅ Workflow state reset');
    }

    saveWorkflow(filename, workflowName = 'New Workflow') {
        const sanitizedNodes = this.workflowNodes.map(n => {
            const nodeSchema = this.getNodeSchema(n.type);
            if (!nodeSchema) throw new Error(`Node type not found: ${n.type}`);
            const typeVersion = this.resolveTypeVersion(nodeSchema, n.typeVersion);
            const sanitizedParameters = this.sanitizeParameters(nodeSchema, n.parameters || {}, typeVersion);
            return {
                ...n,
                typeVersion,
                parameters: sanitizedParameters,
            };
        });

        this.workflowNodes = sanitizedNodes;
        this.saveState();

        const workflow = {
            name: workflowName,
            nodes: sanitizedNodes,
            connections: this.workflowConnections,
            active: false,
            settings: {},
            versionId: "1"
        };
        fs.writeFileSync(filename, JSON.stringify(workflow, null, 2));
        console.log(`✅ Saved workflow to: ${filename}`);
    }

    listWorkflowNodes() {
        console.log(`\n📦 Current Workflow (${this.workflowNodes.length} nodes):`);
        this.workflowNodes.forEach((n, i) => {
            console.log(`  ${i + 1}. ${n.name} [${n.type}]`);
        });
    }
}

// CLI Driver
if (require.main === module) {
    const agentTool = new N8nAgentTool();
    const command = process.argv[2];
    const args = process.argv.slice(3);

    agentTool.init().then(() => {
        switch (command) {
            case 'init-workflow':
                agentTool.resetWorkflow();
                break;

            case 'add-node':
                // node n8n_agent_tool.js add-node <type> <name> <paramsJSON_or_@file> [x] [y]
                if (args.length < 3) {
                    console.error('Usage: add-node <type> <name> <paramsJSON> [x] [y]');
                    process.exit(1);
                }
                try {
                    let params;
                    const paramArg = args[2];

                    if (paramArg.startsWith('file:')) {
                        const paramFile = paramArg.substring(5);
                        if (fs.existsSync(paramFile)) {
                            params = JSON.parse(fs.readFileSync(paramFile, 'utf8'));
                        } else {
                            throw new Error(`Parameter file not found: ${paramFile}`);
                        }
                    } else if (paramArg.startsWith('base64:')) {
                        const b64 = paramArg.substring(7);
                        const jsonStr = Buffer.from(b64, 'base64').toString('utf8');
                        params = JSON.parse(jsonStr);
                    } else {
                        params = JSON.parse(paramArg);
                    }

                    const x = parseInt(args[3] || '0');
                    const y = parseInt(args[4] || '0');
                    agentTool.addNodeToWorkflow(args[0], {
                        name: args[1],
                        parameters: params,
                        position: [x, y]
                    });
                } catch (e) {
                    console.error('❌ Error:', e.message);
                    process.exit(1);
                }
                break;

            case 'connect-nodes':
                // node n8n_agent_tool.js connect-nodes <from> <to> [out] [in]
                if (args.length < 2) {
                    console.error('Usage: connect-nodes <from> <to> [out] [in]');
                    process.exit(1);
                }
                try {
                    agentTool.connectNodes(
                        args[0],
                        args[1],
                        parseInt(args[2] || '0'),
                        parseInt(args[3] || '0')
                    );
                } catch (e) {
                    console.error('❌ Error:', e.message);
                    process.exit(1);
                }
                break;

            case 'list-nodes':
                agentTool.listWorkflowNodes();
                break;

            case 'save-workflow':
                if (args.length < 1) {
                    console.error('Usage: save-workflow <filename> [name]');
                    process.exit(1);
                }
                agentTool.saveWorkflow(args[0], args[1] || 'Agent Built Workflow');
                break;

            case 'get-node-types':
                const types = agentTool.getNodeTypes(args[0] || '');
                console.log(`Found ${types.length} types.`);
                types.slice(0, 10).forEach(t => console.log(`- ${t.type}`));
                break;

            case 'get-options':
                const opts = agentTool.getPropertyOptions(args[0], args[1]);
                if (opts.validOptions) {
                    console.log('Valid options: ' + opts.validOptions.map(o => o.value).join(', '));
                } else {
                    console.log(`Type: ${opts.type}`);
                }
                break;

            case 'get-properties':
                const props = agentTool.getNodeProperties(args[0]);
                console.log(JSON.stringify(props.map(p => p.name), null, 2));
                break;

            default:
                console.log('Commands:');
                console.log('  init-workflow');
                console.log('  add-node <type> <name> <paramsJSON> [x] [y]');
                console.log('  connect-nodes <from> <to> [out] [in]');
                console.log('  list-nodes');
                console.log('  save-workflow <file> [name]');
                console.log('  get-options <type> <prop>');
        }
    }).catch(err => {
        console.error('❌ System Error:', err.message);
        process.exit(1);
    });
}

module.exports = N8nAgentTool;
