/**
 * Schema-Driven Architecture Builder for n8n Workflows
 * 
 * This module provides a safe interface to build n8n workflows by:
 * 1. Loading and caching the node schema
 * 2. Validating all parameters against the schema
 * 3. Providing helpers to discover valid configurations
 * 4. Building workflow JSON with guaranteed valid structure
 * 
 * Usage:
 *   const builder = require('./schema_driven_arch_builder');
 *   await builder.init();
 *   const node = builder.createNode('n8n-nodes-base.webhook', {...});
 */

const fs = require('fs');
const crypto = require('crypto');

class SchemaDrivenArchBuilder {
    constructor() {
        this.schema = null;
        this.nodeCache = new Map();
    }

    /**
     * Initialize by loading the schema
     */
    async init() {
        console.log('🔄 Loading n8n node schema...');
        const schemaPath = './node-types-schema.json';

        if (!fs.existsSync(schemaPath)) {
            throw new Error('Schema not found. Run: node fetch-node-schema.js first');
        }

        this.schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
        console.log(`✅ Loaded ${this.schema.length} node types`);
    }

    /**
     * Get node type schema
     */
    getNodeSchema(nodeType) {
        if (this.nodeCache.has(nodeType)) {
            return this.nodeCache.get(nodeType);
        }

        const nodeSchema = this.schema.find(n => n.name === nodeType);
        if (!nodeSchema) {
            console.warn(`⚠️  Node type not found: ${nodeType}`);
            return null;
        }

        this.nodeCache.set(nodeType, nodeSchema);
        return nodeSchema;
    }

    /**
     * Get all valid properties for a node type
     */
    getValidProperties(nodeType) {
        const schema = this.getNodeSchema(nodeType);
        if (!schema) return [];

        return schema.properties.map(p => ({
            name: p.name,
            type: p.type,
            required: p.required || false,
            default: p.default,
            description: p.description,
            displayOptions: p.displayOptions
        }));
    }

    /**
     * Validate parameters against schema
     */
    validateParameters(nodeType, parameters) {
        const schema = this.getNodeSchema(nodeType);
        if (!schema) {
            return { valid: false, errors: [`Schema not found for ${nodeType}`] };
        }

        const validProps = schema.properties.map(p => p.name);
        const errors = [];

        for (const paramName of Object.keys(parameters)) {
            if (!validProps.includes(paramName)) {
                errors.push(`Invalid property '${paramName}' for ${nodeType}`);
                errors.push(`Valid properties: ${validProps.slice(0, 10).join(', ')}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            validProperties: validProps
        };
    }

    /**
     * Get property details including options
     */
    getPropertyDetails(nodeType, propertyName) {
        const schema = this.getNodeSchema(nodeType);
        if (!schema) return null;

        const prop = schema.properties.find(p => p.name === propertyName);
        if (!prop) return null;

        return {
            name: prop.name,
            displayName: prop.displayName,
            type: prop.type,
            required: prop.required || false,
            default: prop.default,
            description: prop.description,
            options: prop.options || [],
            displayOptions: prop.displayOptions,
            typeOptions: prop.typeOptions
        };
    }

    /**
     * Search for node types
     */
    searchNodes(query) {
        const lowerQuery = query.toLowerCase();
        return this.schema
            .filter(n =>
                n.name.toLowerCase().includes(lowerQuery) ||
                (n.displayName && n.displayName.toLowerCase().includes(lowerQuery))
            )
            .map(n => ({
                name: n.name,
                displayName: n.displayName,
                description: n.description,
                version: n.version
            }));
    }

    /**
     * Create a validated node
     * Returns the node structure with validated parameters
     */
    createNode(nodeType, config = {}) {
        const {
            name,
            parameters = {},
            position = [0, 0],
            credentials = {},
            typeVersion = 1
        } = config;

        // Validate parameters
        const validation = this.validateParameters(nodeType, parameters);
        if (!validation.valid) {
            console.error('❌ Parameter validation failed:');
            validation.errors.forEach(e => console.error('  ', e));
            throw new Error('Invalid parameters for ' + nodeType);
        }

        const node = {
            parameters,
            id: crypto.randomUUID(),
            name: name || nodeType.split('.').pop(),
            type: nodeType,
            typeVersion,
            position
        };

        // Add credentials if provided
        if (Object.keys(credentials).length > 0) {
            node.credentials = credentials;
        }

        // Add webhookId for webhook nodes
        if (nodeType === 'n8n-nodes-base.webhook') {
            node.webhookId = crypto.randomBytes(4).toString('hex');
        }

        return node;
    }

    /**
     * Create a workflow with validated nodes
     */
    createWorkflow(config) {
        const {
            name = 'New Workflow',
            nodes = [],
            connections = {},
            active = false
        } = config;

        return {
            name,
            nodes,
            connections,
            active,
            settings: {},
            versionId: "1"
        };
    }

    /**
     * Save workflow to file
     */
    saveWorkflow(workflow, filename) {
        const json = JSON.stringify(workflow, null, 2);
        fs.writeFileSync(filename, json);
        console.log(`✅ Workflow saved to: ${filename}`);
        return filename;
    }

    /**
     * Interactive helper: Show example for a node type
     */
    showNodeExample(nodeType) {
        const schema = this.getNodeSchema(nodeType);
        if (!schema) {
            console.log(`❌ Node type not found: ${nodeType}`);
            return;
        }

        console.log(`\n📦 ${schema.displayName || nodeType}`);
        console.log(`   Type: ${nodeType}`);
        console.log(`   Version: ${schema.version}`);
        if (schema.description) {
            console.log(`   Description: ${schema.description}`);
        }

        console.log('\n⚙️  Properties:');
        schema.properties.slice(0, 10).forEach(p => {
            const req = p.required ? '(required)' : '(optional)';
            const def = p.default !== undefined ? ` [default: ${JSON.stringify(p.default)}]` : '';
            console.log(`   • ${p.name} ${req}${def}`);
            console.log(`     Type: ${p.type}`);
            if (p.description) {
                console.log(`     ${p.description}`);
            }
        });

        if (schema.properties.length > 10) {
            console.log(`   ... and ${schema.properties.length - 10} more`);
        }
    }
}

// Export singleton
const builder = new SchemaDrivenArchBuilder();

module.exports = builder;

// CLI interface if run directly
if (require.main === module) {
    const command = process.argv[2];
    const arg = process.argv[3];

    builder.init().then(() => {
        switch (command) {
            case 'search':
                if (!arg) {
                    console.log('Usage: node schema_driven_arch_builder.js search <query>');
                    return;
                }
                const results = builder.searchNodes(arg);
                console.log(`\n🔍 Found ${results.length} nodes matching '${arg}':\n`);
                results.slice(0, 20).forEach(n => {
                    console.log(`📦 ${n.displayName || n.name}`);
                    console.log(`   ${n.name}`);
                    if (n.description) console.log(`   ${n.description}`);
                    console.log('');
                });
                break;

            case 'show':
                if (!arg) {
                    console.log('Usage: node schema_driven_arch_builder.js show <nodeType>');
                    return;
                }
                builder.showNodeExample(arg);
                break;

            case 'list':
                const category = arg || 'all';
                console.log(`\n📋 Available node types (${category}):\n`);
                const nodes = builder.schema.slice(0, 50);
                nodes.forEach(n => {
                    console.log(`  ${n.name}`);
                });
                console.log(`\n... ${builder.schema.length} total nodes`);
                break;

            default:
                console.log('Schema-Driven Architecture Builder');
                console.log('');
                console.log('Commands:');
                console.log('  search <query>   - Search for node types');
                console.log('  show <nodeType>  - Show node details and properties');
                console.log('  list [category]  - List available nodes');
                console.log('');
                console.log('Examples:');
                console.log('  node schema_driven_arch_builder.js search slack');
                console.log('  node schema_driven_arch_builder.js show n8n-nodes-base.webhook');
        }
    }).catch(err => {
        console.error('❌ Error:', err.message);
    });
}
