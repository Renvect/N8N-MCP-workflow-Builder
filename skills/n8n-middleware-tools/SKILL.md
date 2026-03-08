---
name: n8n-middleware-tools
description: Expert guide for using N8N Middleware MCP tools. Use when building workflows, adding nodes, connecting nodes, managing executions, configuring credentials, or any n8n-related operation via the middleware. Provides tool selection, parameter formats, and usage patterns for all 62 MCP tools.
---

# N8N Middleware Tools Expert

Master guide for the 62 MCP tools exposed by the N8N Middleware Controller.

---

## Tool Categories

| Category | Count | Purpose |
|----------|-------|---------|
| **Workflow Builder** | 15 | Create/edit workflows in-memory |
| **Workflow API** | 12 | CRUD operations on n8n |
| **Execution API** | 4 | Run/monitor executions |
| **Credential API** | 4 | Manage credentials |
| **Tag API** | 6 | Manage tags |
| **Admin API** | 15 | Users, projects, variables |
| **Utility** | 6 | Health, config, testing |

---

## 🚨 CRITICAL: Order of Operations

### 1️⃣ ALWAYS Start With Init + Schema
```
1. n8n_init_workflow         → Initialize state machine (ALWAYS FIRST!)
2. n8n_get_schema            → Get schemas for nodes you'll use (CRITICAL!)
```
> ⚠️ **Schema is the most important step!** Never add nodes without checking their schema first.

### 2️⃣ Creating New Workflows (Use Batch Operations!)
```
3. n8n_add_nodes_batch       → Add ALL nodes at once (prefer over 1-by-1)
4. n8n_configure_nodes_batch → Configure ALL nodes at once (REQUIRED!)
5. n8n_connect_nodes_batch   → Wire main workflow connections
6. n8n_connect_subnode       → Wire AI subnodes ONLY (model→agent, tool→agent)
7. n8n_create_workflow_from_state → Push to n8n
```

### 3️⃣ Editing Existing Workflows
```
1. n8n_load_workflow_to_state → Load from n8n
2. n8n_get_schema            → Check schemas before changes
3. Make changes (use batch operations)
4. n8n_workflow_update_from_state → Push changes
```

### 4️⃣ Connection Types (IMPORTANT!)
```
n8n_connect_nodes_batch  → Main workflow flow (Trigger→Process→Output)
n8n_connect_subnode      → AI subnodes ONLY (OpenAI Model→AI Agent, Tool→Agent)
```

> 🔴 **NEVER use connect_nodes_batch for AI subnodes!** They require typed connections.
> 🟢 **Subnode types:** ai_languageModel, ai_tool, ai_memory, ai_outputParser

---

## Workflow Building Tools (15)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_init_workflow` | Initialize empty workflow | None |
| `n8n_add_nodes_batch` | Add multiple nodes | `nodes[]` |
| `n8n_connect_nodes_batch` | Connect node pairs | `connections[]` |
| `n8n_connect_subnode` | Connect AI subnodes | `from`, `to` |
| `n8n_configure_nodes_batch` | Update node params | `configurations[]` |
| `n8n_remove_node` | Remove single node | `nodeName` |
| `n8n_remove_nodes_batch` | Remove multiple nodes | `nodeNames[]` |
| `n8n_disconnect_nodes` | Remove connection | `from`, `to` |
| `n8n_disconnect_all_from_node` | Clear all connections | `nodeName` |
| `n8n_save_workflow` | Export to file | `filename` |
| `n8n_list_nodes` | List current nodes | None |
| `n8n_get_schema` | Get node schema | `nodeType` |
| `n8n_get_schema_detail` | Get detailed schema | `nodeType` |
| `n8n_load_workflow_to_state` | Import from n8n | `workflowId` |
| `n8n_list_workflow_slots` | List all workflow slots | None |
| `n8n_switch_workflow_slot` | Switch workflow context | `slotName` |

---

## Workflow API Tools (12)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_workflow_list` | List all workflows | None |
| `n8n_workflow_read` | Get workflow by ID | `workflowId` |
| `n8n_workflow_create` | Create workflow | `name` |
| `n8n_workflow_update` | Update workflow | `workflowId` |
| `n8n_workflow_delete` | Delete workflow | `workflowId` |
| `n8n_workflow_activate` | Activate workflow | `workflowId` |
| `n8n_workflow_deactivate` | Deactivate workflow | `workflowId` |
| `n8n_workflow_move` | Move to project | `workflowId`, `destinationProjectId` |
| `n8n_create_workflow_from_state` | Create from builder state | None (uses current state) |
| `n8n_workflow_update_from_state` | Update from builder state | `workflowId` |
| `n8n_execute_workflow` | Run workflow manually | `workflowId` |

---

## Execution API Tools (4)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_execution_list` | List executions | None |
| `n8n_execution_read` | Get execution details | `executionId` |
| `n8n_execution_delete` | Delete execution | `executionId` |
| `n8n_execution_retry` | Retry failed execution | `executionId` |

---

## Credential API Tools (4)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_credential_list` | List credentials | None |
| `n8n_credential_create` | Create credential | `name`, `type`, `data` |
| `n8n_credential_delete` | Delete credential | `credentialId` |
| `n8n_credential_move` | Move credential | `credentialId`, `destinationProjectId` |

---

## Tag API Tools (6)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_tag_list` | List all tags | None |
| `n8n_tag_read` | Get tag by ID | `tagId` |
| `n8n_tag_create` | Create tag | `name` |
| `n8n_tag_update` | Update tag | `tagId`, `name` |
| `n8n_tag_delete` | Delete tag | `tagId` |
| `n8n_workflowtags_update` | Update workflow tags | `workflowId`, `tagIds[]` |

---

## Admin API Tools

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_variable_list` | List variables | None |
| `n8n_variable_create` | Create variable | `key`, `value` |
| `n8n_variable_update` | Update variable | `variableId` |
| `n8n_variable_delete` | Delete variable | `variableId` |
| `n8n_user_list` | List users | None |
| `n8n_user_read` | Get user | `userId` |
| `n8n_user_create` | Create user | `email` |
| `n8n_user_delete` | Delete user | `userId` |
| `n8n_user_changeRole` | Change role | `userId`, `role` |
| `n8n_project_list` | List projects | None |
| `n8n_project_create` | Create project | `name` |
| `n8n_project_update` | Update project | `projectId`, `name` |
| `n8n_project_delete` | Delete project | `projectId` |
| `n8n_sourcecontrol_pull` | Pull from source control | None |
| `n8n_securityaudit_generate` | Generate audit | None |

---

## Utility Tools (6)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `n8n_test_connection` | Test n8n connection | None |
| `n8n_health` | Check middleware health | None |
| `n8n_config` | Get current config | None |

---

## Common Mistakes

### Mistake 1: Wrong Connection for AI Nodes
```javascript
// ❌ Wrong - main connection for AI subnode
n8n_connect_nodes_batch({
  connections: [{ from: "OpenAI Model", to: "AI Agent" }]
})

// ✅ Correct - use connect_subnode
n8n_connect_subnode({
  from: "OpenAI Model",
  to: "AI Agent"
  // type is inferred automatically from schema
})
```

### Mistake 2: Creating Unconfigured Nodes
```javascript
// ❌ Wrong - node without parameters
n8n_add_nodes_batch({
  nodes: [{ nodeType: "n8n-nodes-base.httpRequest", name: "HTTP" }]
})
// Creates broken node with no URL!

// ✅ Correct - always configure after adding
n8n_add_nodes_batch({
  nodes: [{ nodeType: "n8n-nodes-base.httpRequest", name: "HTTP" }]
})
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "HTTP",
    parameters: {
      method: "POST",
      url: "https://api.example.com",
      sendBody: true,
      bodyContentType: "json"
    }
  }]
})
```

### Mistake 3: Skipping Initialization
```javascript
// ❌ Wrong - adding nodes without init
n8n_add_nodes_batch({...})

// ✅ Correct - always init first for new workflows
n8n_init_workflow()
n8n_add_nodes_batch({...})
```

### Mistake 4: Direct n8n API Calls
```javascript
// ❌ Wrong - calling n8n directly
fetch('http://localhost:5678/rest/workflows')

// ✅ Correct - use middleware tools
n8n_workflow_list()
```

---

## Usage Patterns

### Pattern 1: Build New Workflow
```javascript
// 1. Initialize state machine
n8n_init_workflow()

// 2. Get schemas for nodes you'll use (CRITICAL!)
n8n_get_schema({ nodeType: "n8n-nodes-base.webhook" })
n8n_get_schema({ nodeType: "n8n-nodes-base.slack" })

// 3. Add ALL nodes at once (batch!)
n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.webhook", name: "Webhook", x: 250, y: 300 },
    { nodeType: "n8n-nodes-base.slack", name: "Slack", x: 500, y: 300 }
  ]
})

// 4. Configure ALL nodes at once (batch!)
n8n_configure_nodes_batch({
  configurations: [
    { nodeName: "Webhook", parameters: { path: "incoming", httpMethod: "POST" }},
    { nodeName: "Slack", parameters: { 
      resource: "message", 
      operation: "post", 
      channel: "#alerts", 
      text: "={{$json.body.message}}" 
    }}
  ]
})

// 5. Connect main workflow flow
n8n_connect_nodes_batch({
  connections: [{ from: "Webhook", to: "Slack" }]
})

// 6. Create in n8n
n8n_create_workflow_from_state({ name: "Webhook to Slack" })
```

### Pattern 2: Edit Existing Workflow
```javascript
// 1. Load workflow
n8n_load_workflow_to_state({ workflowId: "abc123" })

// 2. View current nodes
n8n_list_nodes()

// 3. Get schema before changes (if adding new node types)
n8n_get_schema({ nodeType: "n8n-nodes-base.httpRequest" })

// 4. Make changes (use batch operations!)
n8n_add_nodes_batch({...})
n8n_configure_nodes_batch({...})
n8n_connect_nodes_batch({...})

// 5. Push changes
n8n_workflow_update_from_state({ workflowId: "abc123" })
```

### Pattern 3: AI Agent Workflow
```javascript
// 1. Initialize
n8n_init_workflow()

// 2. Get schemas (CRITICAL for AI nodes!)
n8n_get_schema({ nodeType: "@n8n/n8n-nodes-langchain.agent" })
n8n_get_schema({ nodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi" })

// 3. Add ALL nodes (batch!)
n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.manualTrigger", name: "Trigger" },
    { nodeType: "@n8n/n8n-nodes-langchain.agent", name: "AI Agent" },
    { nodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi", name: "OpenAI" }
  ]
})

// 4. Configure ALL nodes (batch!)
n8n_configure_nodes_batch({
  configurations: [
    { nodeName: "OpenAI", parameters: { model: "gpt-4o" }},
    { nodeName: "AI Agent", parameters: { systemMessage: "You are helpful." }}
  ]
})

// 5. Connect MAIN workflow (Trigger → AI Agent)
n8n_connect_nodes_batch({ connections: [{ from: "Trigger", to: "AI Agent" }] })

// 6. Connect SUBNODE (OpenAI → AI Agent) - Different tool!
n8n_connect_subnode({ from: "OpenAI", to: "AI Agent" })
// Type is auto-inferred (ai_languageModel)

// 7. Create workflow
n8n_create_workflow_from_state({ name: "AI Agent Workflow" })
```

---

## Best Practices

### ✅ Do
1. **ALWAYS** call `n8n_init_workflow` first (initializes state machine)
2. **ALWAYS** call `n8n_get_schema` before adding nodes (most important step!)
3. Use **batch operations** (`add_nodes_batch`, `configure_nodes_batch`) over single operations
4. Use `n8n_connect_nodes_batch` for main workflow connections
5. Use `n8n_connect_subnode` ONLY for AI subnodes (model→agent, tool→agent)
6. Check `n8n_list_nodes` after mutations to verify state
7. Use environment variable expressions (`={{$env.API_KEY}}`) for secrets

### ❌ Don't
- Skip initialization (`n8n_init_workflow`)
- Skip schema lookup (`n8n_get_schema`)
- Add nodes one-by-one (use batch unless doing quick swaps)
- Create nodes without configuration
- Use `n8n_connect_nodes_batch` for AI subnodes (they need typed connections!)
- Use `n8n_connect_subnode` for regular node connections
- Call n8n API directly (always use middleware tools)
- Hardcode secrets in parameters

---

## CLI Parity Reference

| MCP Tool | CLI Command |
|----------|-------------|
| `n8n_init_workflow` | `builder init` |
| `n8n_load_workflow_to_state` | `builder load --id <id>` |
| `n8n_list_nodes` | `builder list-nodes` |
| `n8n_add_nodes_batch` | `builder add-batch --nodes <json>` |
| `n8n_connect_nodes_batch` | `builder connect-batch --connections <json>` |
| `n8n_configure_nodes_batch` | `builder configure-batch --configurations <json>` |
| `n8n_connect_subnode` | `builder connect-subnode --from <n> --to <n>` |
| `n8n_create_workflow_from_state` | `builder create-from-state --name <n>` |
| `n8n_workflow_update_from_state` | `builder update-remote --id <id>` |
| `n8n_get_schema` | `builder get-schema --node-type <t>` |
| `n8n_get_schema_detail` | `builder get-schema-detail --node-type <t>` |

---

## Summary

**Correct Order of Operations:**
```
1. n8n_init_workflow       → Always first!
2. n8n_get_schema          → For each node type you'll use
3. n8n_add_nodes_batch     → Add all nodes at once
4. n8n_configure_nodes_batch → Configure all nodes at once
5. n8n_connect_nodes_batch → Main workflow connections
6. n8n_connect_subnode     → AI subnodes only (model→agent)
7. n8n_create_workflow_from_state → Push to n8n
```

**Quick Selection:**
- 🆕 **New workflow?** → init → schema → batch-add → batch-configure → connect → create
- ✏️ **Edit workflow?** → load → schema → batch-mutate → update
- 🤖 **AI workflow?** → Use `n8n_connect_subnode` for model/tool→agent only
- 🔍 **Check schema?** → `n8n_get_schema` (ALWAYS before adding unfamiliar nodes!)
- 🔗 **Test connection?** → `n8n_test_connection` / `n8n_health`
