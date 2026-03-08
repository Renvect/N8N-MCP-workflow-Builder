# N8N Middleware CLI Commands Reference

This document provides a comprehensive reference for all CLI commands available in the N8N Agent Middleware. These commands interact with the middleware API server running on `http://localhost:3456`.

## Table of Contents
- [Workflow Commands](#workflow-commands)
- [Builder Commands (MCP Parity)](#builder-commands-mcp-parity)
- [Execution Commands](#execution-commands)
- [Credential Commands](#credential-commands)
- [Tag Commands](#tag-commands)
- [Workflow Tags Commands](#workflow-tags-commands)
- [Variable Commands](#variable-commands)
- [User Commands](#user-commands)
- [Project Commands](#project-commands)
- [Utility Commands](#utility-commands)
- [MCP Tools](#mcp-tools)

---

## Workflow Commands

Manage n8n workflows via the middleware API.

### `workflow list`
List all workflows from n8n.

**Options:**
- `--active` - Only show active workflows
- `--tags <tags>` - Filter by tag IDs (comma-separated)

**Example:**
```bash
node dist\cli.js workflow list
node dist\cli.js workflow list --active
node dist\cli.js workflow list --tags "tag1,tag2"
```

**Endpoint:** `/api/n8n/workflow_list`

---

### `workflow read`
Get detailed information about a specific workflow.

**Options:**
- `--id <id>` - **(Required)** Workflow ID

**Example:**
```bash
node dist\cli.js workflow read --id coNSeCI5MUSTey1U
```

**Endpoint:** `/api/n8n/workflow_read`

---

### `workflow create`
Create a new workflow from JSON file or inline data.

**Options:**
- `--name <name>` - **(Required)** Workflow name
- `--file <file>` - JSON file with nodes/connections
- `--nodes <json>` - Nodes as JSON string
- `--connections <json>` - Connections as JSON string

**Example:**
```bash
node dist\cli.js workflow create --name "My Workflow" --file workflow.json
```

**Endpoint:** `/api/mcp/workflow_create` (uses schema sanitization)

---

### `workflow update`
Update an existing workflow.

**Options:**
- `--id <id>` - **(Required)** Workflow ID
- `--name <name>` - New workflow name
- `--file <file>` - JSON file with updates

**Example:**
```bash
node dist\cli.js workflow update --id coNSeCI5MUSTey1U --name "Updated Name"
```

**Endpoint:** `/api/n8n/workflow_update`

---

### `workflow run`
Execute a workflow manually.

**Options:**
- `--id <id>` - **(Required)** Workflow ID
- `--data <json>` - Input data as JSON string (default: `{}`)

**Example:**
```bash
node dist\cli.js workflow run --id coNSeCI5MUSTey1U --data "{\"key\":\"value\"}"
```

You can also pass JSON via stdin using `-`:
```bash
echo "{\"key\":\"value\"}" | node dist\cli.js workflow run --id coNSeCI5MUSTey1U --data -
```

**Endpoint:** `/api/n8n/execute_workflow`

---

### `workflow diagnose`
Run a workflow and return detailed diagnostics (polls until finished and fetches the execution with `includeData=true`).

This command is designed for troubleshooting failures. It will attempt (by default) to temporarily enable n8n workflow settings that help ensure execution data is saved, so node-level error details are available.

**Options:**
- `--id <id>` - **(Required)** Workflow ID
- `--data <json>` - Input data as JSON string (use `-` for stdin, default: `{}`)
- `--no-wait` - Do not wait for the execution to finish (returns `executionId` only)
- `--timeout <ms>` - Max time to wait for completion (default: `60000`)
- `--interval <ms>` - Polling interval (default: `1000`)
- `--no-ensure-save-data` - Do not attempt to temporarily change workflow settings to ensure execution data is saved
- `--no-restore-settings` - Do not restore original workflow settings after diagnostics
- `--include-execution` - Include the raw execution object in output

**Examples:**
```bash
# Diagnose with inline JSON
node dist\cli.js workflow diagnose --id coNSeCI5MUSTey1U --data "{\"key\":\"value\"}"

# Diagnose with stdin JSON
echo "{\"key\":\"value\"}" | node dist\cli.js workflow diagnose --id coNSeCI5MUSTey1U --data -

# Return immediately (no polling)
node dist\cli.js workflow diagnose --id coNSeCI5MUSTey1U --no-wait

# Include full raw execution in output
node dist\cli.js workflow diagnose --id coNSeCI5MUSTey1U --include-execution
```

**Output (high-level):**
- `executionId` - The created execution ID
- `diagnostics.status` - Execution status
- `diagnostics.lastNodeExecuted` - Last node executed (if available)
- `diagnostics.error` - Error object (if available)
- `diagnostics.stack` - Stack trace (if available)
- `diagnostics.node` - Failed node name/type (if available)
- `warnings[]` - Warnings (for example if execution-data saving settings could not be patched, or polling timed out)

**Endpoint:** `/api/n8n/workflow_diagnose`

---

### `workflow activate`
Activate a workflow.

**Options:**
- `--id <id>` - **(Required)** Workflow ID

**Example:**
```bash
node dist\cli.js workflow activate --id coNSeCI5MUSTey1U
```

**Endpoint:** `/api/n8n/workflow_activate`

---

### `workflow deactivate`
Deactivate a workflow.

**Options:**
- `--id <id>` - **(Required)** Workflow ID

**Example:**
```bash
node dist\cli.js workflow deactivate --id coNSeCI5MUSTey1U
```

**Endpoint:** `/api/n8n/workflow_deactivate`

---

### `workflow delete`
Delete a workflow permanently.

**Options:**
- `--id <id>` - **(Required)** Workflow ID

**Example:**
```bash
node dist\cli.js workflow delete --id coNSeCI5MUSTey1U
```

**Endpoint:** `/api/n8n/workflow_delete`

---

### `workflow move`
Move a workflow to another project.

**Options:**
- `--id <id>` - **(Required)** Workflow ID
- `--project <projectId>` - **(Required)** Destination project ID

**Example:**
```bash
node dist\cli.js workflow move --id coNSeCI5MUSTey1U --project ogO4S7zUZmVpw0JA
```

**Endpoint:** `/api/n8n/workflow_move`

---

## Builder Commands (MCP Parity)

Stateful workflow builder commands that maintain an in-memory workflow state. These commands mirror the MCP server tools and allow you to build/edit workflows incrementally before pushing to n8n.

### `builder init`
Initialize or reset the in-memory workflow state.

**Purpose:** Start fresh with an empty workflow state.

**Example:**
```bash
node dist\cli.js builder init
```

**Endpoint:** `/api/mcp/init_workflow`

---

### `builder load`
Load an existing n8n workflow into the state machine.

**Purpose:** Import a workflow from n8n to edit it locally.

**Options:**
- `--id <workflowId>` - **(Required)** Workflow ID to load
- `--slot <name>` - State slot name (for multi-workflow management)

**Example:**
```bash
node dist\cli.js builder load --id coNSeCI5MUSTey1U
node dist\cli.js builder load --id coNSeCI5MUSTey1U --slot "incident-workflow"
```

**Endpoint:** `/api/mcp/load_workflow_to_state`

---

### `builder list-nodes`
List all nodes in the current workflow state.

**Purpose:** View the current workflow structure.

**Example:**
```bash
node dist\cli.js builder list-nodes
```

**Endpoint:** `/api/mcp/list_nodes`

---

### `builder add-batch`
Add multiple nodes to the workflow state at once.

**Purpose:** Batch add nodes for efficiency.

**Options:**
- `--nodes <json>` - **(Required)** Array of node specifications as JSON

**Node Spec Format:**
```json
[
  {
    "nodeType": "n8n-nodes-base.httpRequest",
    "name": "HTTP Request",
    "parameters": {"url": "https://example.com"},
    "x": 100,
    "y": 200
  }
]
```

**Example (PowerShell - use file for complex JSON):**
```bash
# Save JSON to file first
node dist\cli.js builder add-batch --nodes "@nodes.json"
```

**Endpoint:** `/api/mcp/add_nodes_batch`

---

### `builder connect-batch`
Connect multiple node pairs at once.

**Purpose:** Batch create connections between nodes.

**Options:**
- `--connections <json>` - **(Required)** Array of connection specifications

**Connection Spec Format:**
```json
[
  {
    "from": "Node A",
    "to": "Node B",
    "outputIndex": 0,
    "inputIndex": 0
  }
]
```

**Example:**
```bash
# Use file for JSON
node dist\cli.js builder connect-batch --connections "@connections.json"
```

**Endpoint:** `/api/mcp/connect_nodes_batch`

---

### `builder connect-subnode`
Connect a sub-node (e.g. AI Chat Model / Tool) to a parent node.

**Purpose:** Create a single connection intended for subnode wiring.

**Important:** If you omit `--type`, the middleware will infer the correct `ai_*` connection type from schema.

**Options:**
- `--from <node>` - **(Required)** Source node name (sub-node)
- `--to <node>` - **(Required)** Target node name (parent node)
- `--type <type>` - Connection type (e.g. `ai_languageModel`, `ai_tool`). Optional.
- `--input-type <type>` - Input type (overrides `--type`). Optional.
- `--output-type <type>` - Output type (overrides `--type`). Optional.
- `--input <n>` - Target input index (default: `0`)
- `--output <n>` - Source output index (default: `0`)

**Examples:**
```bash
# Preferred: let middleware infer correct AI types
node dist\cli.js builder connect-subnode --from "Gemini Chat Model" --to "AI Agent"
node dist\cli.js builder connect-subnode --from "Web Search Tool" --to "AI Agent"

# Explicit AI type (only if needed)
node dist\cli.js builder connect-subnode --from "Gemini Chat Model" --to "AI Agent" --type ai_languageModel
node dist\cli.js builder connect-subnode --from "Web Search Tool" --to "AI Agent" --type ai_tool
```

**Endpoint:** `/api/mcp/connect_nodes_batch` (single-item `connections[]` payload)

---

### `builder disconnect`
Disconnect a specific connection between two nodes.

**Purpose:** Remove a single connection.

**Options:**
- `--from <node>` - **(Required)** Source node name
- `--to <node>` - **(Required)** Target node name
- `--output <n>` - Source output index (default: 0)
- `--input <n>` - Target input index (default: 0)

**Example:**
```bash
node dist\cli.js builder disconnect --from "LLM Analyze Incident" --to "Parse LLM Response"
```

**Endpoint:** `/api/mcp/disconnect_nodes`

---

### `builder disconnect-all-from`
Disconnect all connections to/from a specific node.

**Purpose:** Remove all connections for a node (useful before removing it).

**Options:**
- `--name <nodeName>` - **(Required)** Node name

**Example:**
```bash
node dist\cli.js builder disconnect-all-from --name "Old Node"
```

**Endpoint:** `/api/mcp/disconnect_all_from_node`

---

### `builder configure-batch`
Configure parameters for multiple nodes at once.

**Purpose:** Batch update node configurations.

**Options:**
- `--configurations <json>` - **(Required)** Array of configuration specs

**Configuration Spec Format:**
```json
[
  {
    "nodeName": "HTTP Request",
    "parameters": {"url": "https://newurl.com", "method": "POST"}
  }
]
```

**Example:**
```bash
node dist\cli.js builder configure-batch --configurations "@configs.json"
```

**Endpoint:** `/api/mcp/configure_nodes_batch`

---

### `builder remove`
Remove a single node by name.

**Purpose:** Delete one node from the workflow state.

**Options:**
- `--name <nodeName>` - **(Required)** Node name to remove

**Example:**
```bash
node dist\cli.js builder remove --name "Unused Node"
```

**Endpoint:** `/api/mcp/remove_node`

---

### `builder remove-batch`
Remove multiple nodes by names.

**Purpose:** Batch delete nodes.

**Options:**
- `--names <list>` - **(Required)** Comma-separated names or JSON array

**Example:**
```bash
node dist\cli.js builder remove-batch --names "Node1,Node2,Node3"
```

**Endpoint:** `/api/mcp/remove_nodes_batch`

---

### `builder save`
Save the current workflow state to a JSON file.

**Purpose:** Export workflow state to disk.

**Options:**
- `--file <path>` - **(Required)** Output JSON file path
- `--name <name>` - Workflow name (default: "Workflow")

**Example:**
```bash
node dist\cli.js builder save --file workflow_backup.json --name "My Workflow"
```

**Endpoint:** `/api/mcp/save_workflow`

---

### `builder create-from-state`
Create a new n8n workflow from the current state.

**Purpose:** Push the current state as a new workflow to n8n.

**Options:**
- `--name <name>` - Workflow name (default: "Workflow")

**Example:**
```bash
node dist\cli.js builder create-from-state --name "New Incident Handler"
```

**Endpoint:** `/api/mcp/create_workflow_from_state` (uses schema sanitization)

---

### `builder update-remote`
Update an existing n8n workflow from the current state.

**Purpose:** Push local state changes back to an existing workflow in n8n.

**Options:**
- `--id <workflowId>` - **(Required)** Workflow ID to update
- `--slot <name>` - State slot name (defaults to current)
- `--name <name>` - Override workflow name in n8n

**Example:**
```bash
node dist\cli.js builder update-remote --id coNSeCI5MUSTey1U
node dist\cli.js builder update-remote --id coNSeCI5MUSTey1U --name "Updated Workflow"
```

**Endpoint:** `/api/mcp/workflow_update_from_state` (uses schema sanitization)

---

### `builder switch-slot`
Switch to a different workflow state slot.

**Purpose:** Manage multiple workflows simultaneously.

**Options:**
- `--slot <name>` - **(Required)** Slot name to switch to

**Example:**
```bash
node dist\cli.js builder switch-slot --slot "incident-workflow"
```

**Endpoint:** `/api/mcp/switch_workflow_slot`

---

### `builder list-slots`
List all available workflow state slots.

**Purpose:** See all loaded workflows in memory.

**Example:**
```bash
node dist\cli.js builder list-slots
```

**Endpoint:** `/api/mcp/list_workflow_slots`

---

### `builder get-schema`
Get the complete node schema used by the builder.

**Purpose:** View all available node types and their properties.

**Example:**
```bash
node dist\cli.js builder get-schema
```

**Endpoint:** `/api/mcp/get_schema`

---

### `builder get-schema-detail`
Get detailed schema information for a specific node type.

**Purpose:** Introspect a node type's properties and options.

**Options:**
- `--node-type <name>` - **(Required)** Node type name (e.g., "n8n-nodes-base.httpRequest")
- `--property <prop>` - Specific property name to inspect

**Example:**
```bash
node dist\cli.js builder get-schema-detail --node-type "n8n-nodes-base.httpRequest"
node dist\cli.js builder get-schema-detail --node-type "n8n-nodes-base.httpRequest" --property "url"
```

**Endpoint:** `/api/mcp/get_schema_detail`

---

## Execution Commands

Manage workflow executions.

### `execution list`
List workflow executions.

**Options:**
- `--workflow <id>` - Filter by workflow ID
- `--status <status>` - Filter by status (success, error, waiting)
- `--limit <n>` - Max results (default: 20)

**Advanced:** The middleware endpoint also supports `includeData` (to request detailed execution payloads from n8n when available).

**Example:**
```bash
node dist\cli.js execution list --status error --limit 10
```

**Endpoint:** `/api/n8n/execution_list`

---

### `execution read`
Get detailed execution information.

**Options:**
- `--id <id>` - **(Required)** Execution ID

**Advanced:** The middleware endpoint supports `includeData` (to request detailed node-level execution data from n8n when available). For most diagnostics, prefer `workflow diagnose`.

**Example:**
```bash
node dist\cli.js execution read --id exec123
```

**Endpoint:** `/api/n8n/execution_read`

---

### `execution retry`
Retry a failed execution.

**Options:**
- `--id <id>` - **(Required)** Execution ID

**Example:**
```bash
node dist\cli.js execution retry --id exec123
```

**Endpoint:** `/api/n8n/execution_retry`

---

### `execution delete`
Delete an execution record.

**Options:**
- `--id <id>` - **(Required)** Execution ID

**Example:**
```bash
node dist\cli.js execution delete --id exec123
```

**Endpoint:** `/api/n8n/execution_delete`

---

## Credential Commands

Manage n8n credentials.

### `credential list`
List all credentials.

**Example:**
```bash
node dist\cli.js credential list
```

**Endpoint:** `/api/n8n/credential_list`

---

### `credential create`
Create a new credential.

**Options:**
- `--name <name>` - **(Required)** Credential name
- `--type <type>` - **(Required)** Credential type (e.g., httpBasicAuth, slackApi)
- `--data <json>` - **(Required)** Credential data as JSON

**Example:**
```bash
node dist\cli.js credential create --name "My API Key" --type "httpHeaderAuth" --data "{\"name\":\"X-API-Key\",\"value\":\"secret\"}"
```

**Endpoint:** `/api/n8n/credential_create`

---

### `credential delete`
Delete a credential.

**Options:**
- `--id <id>` - **(Required)** Credential ID

**Example:**
```bash
node dist\cli.js credential delete --id cred123
```

**Endpoint:** `/api/n8n/credential_delete`

---

### `credential move`
Move credential to another project.

**Options:**
- `--id <id>` - **(Required)** Credential ID
- `--project <projectId>` - **(Required)** Destination project ID

**Example:**
```bash
node dist\cli.js credential move --id cred123 --project proj456
```

**Endpoint:** `/api/n8n/credential_move`

---

## Tag Commands

Manage n8n tags.

### `tag list`
List all tags.

**Example:**
```bash
node dist\cli.js tag list
```

**Endpoint:** `/api/n8n/tag_list`

---

### `tag create`
Create a new tag.

**Options:**
- `--name <name>` - **(Required)** Tag name

**Example:**
```bash
node dist\cli.js tag create --name "Production"
```

**Endpoint:** `/api/n8n/tag_create`

---

### `tag read`
Get tag details by ID.

**Options:**
- `--id <id>` - **(Required)** Tag ID

**Example:**
```bash
node dist\cli.js tag read --id tag123
```

**Endpoint:** `/api/n8n/tag_read`

---

### `tag update`
Update a tag name.

**Options:**
- `--id <id>` - **(Required)** Tag ID
- `--name <name>` - **(Required)** New tag name

**Example:**
```bash
node dist\cli.js tag update --id tag123 --name "Staging"
```

**Endpoint:** `/api/n8n/tag_update`

---

### `tag delete`
Delete a tag.

**Options:**
- `--id <id>` - **(Required)** Tag ID

**Example:**
```bash
node dist\cli.js tag delete --id tag123
```

**Endpoint:** `/api/n8n/tag_delete`

---

## Workflow Tags Commands

Manage tags assigned to workflows.

### `workflow-tags list`
List tags for a specific workflow.

**Options:**
- `--workflow <id>` - **(Required)** Workflow ID

**Example:**
```bash
node dist\cli.js workflow-tags list --workflow coNSeCI5MUSTey1U
```

**Endpoint:** `/api/n8n/workflowtags_list`

---

### `workflow-tags update`
Update tags for a workflow.

**Options:**
- `--workflow <id>` - **(Required)** Workflow ID
- `--tags <ids>` - **(Required)** Tag IDs (comma-separated)

**Example:**
```bash
node dist\cli.js workflow-tags update --workflow coNSeCI5MUSTey1U --tags "tag1,tag2"
```

**Endpoint:** `/api/n8n/workflowtags_update`

---

## Variable Commands

Manage n8n environment variables.

### `variable list`
List all variables.

**Example:**
```bash
node dist\cli.js variable list
```

**Endpoint:** `/api/n8n/variable_list`

---

### `variable create`
Create a new variable.

**Options:**
- `--key <key>` - **(Required)** Variable key
- `--value <value>` - **(Required)** Variable value

**Example:**
```bash
node dist\cli.js variable create --key "API_URL" --value "https://api.example.com"
```

**Endpoint:** `/api/n8n/variable_create`

---

### `variable update`
Update a variable.

**Options:**
- `--id <id>` - **(Required)** Variable ID
- `--key <key>` - New variable key
- `--value <value>` - New variable value

**Example:**
```bash
node dist\cli.js variable update --id var123 --value "https://new-api.example.com"
```

**Endpoint:** `/api/n8n/variable_update`

---

### `variable delete`
Delete a variable.

**Options:**
- `--id <id>` - **(Required)** Variable ID

**Example:**
```bash
node dist\cli.js variable delete --id var123
```

**Endpoint:** `/api/n8n/variable_delete`

---

## User Commands

Manage n8n users (requires admin privileges).

### `user list`
List all users.

**Options:**
- `--include-role` - Include role information

**Example:**
```bash
node dist\cli.js user list --include-role
```

**Endpoint:** `/api/n8n/user_list`

---

### `user read`
Get user details.

**Options:**
- `--id <id>` - **(Required)** User ID

**Example:**
```bash
node dist\cli.js user read --id user123
```

**Endpoint:** `/api/n8n/user_read`

---

### `user create`
Create a new user.

**Options:**
- `--email <email>` - **(Required)** User email
- `--first-name <name>` - First name
- `--last-name <name>` - Last name
- `--role <role>` - Role (global:admin, global:member)

**Example:**
```bash
node dist\cli.js user create --email "user@example.com" --first-name "John" --last-name "Doe" --role "global:member"
```

**Endpoint:** `/api/n8n/user_create`

---

### `user delete`
Delete a user.

**Options:**
- `--id <id>` - **(Required)** User ID

**Example:**
```bash
node dist\cli.js user delete --id user123
```

**Endpoint:** `/api/n8n/user_delete`

---

### `user change-role`
Change a user's role.

**Options:**
- `--id <id>` - **(Required)** User ID
- `--role <role>` - **(Required)** New role (global:admin, global:member)

**Example:**
```bash
node dist\cli.js user change-role --id user123 --role "global:admin"
```

**Endpoint:** `/api/n8n/user_changeRole`

---

### `user enforce-mfa`
Enforce MFA for a user.

**Options:**
- `--id <id>` - **(Required)** User ID
- `--enabled` - Enable MFA (default: true)

**Example:**
```bash
node dist\cli.js user enforce-mfa --id user123 --enabled
```

**Endpoint:** `/api/n8n/user_enforceMfa`

---

## Project Commands

Manage n8n projects.

### `project list`
List all projects.

**Example:**
```bash
node dist\cli.js project list
```

**Endpoint:** `/api/n8n/project_list`

---

### `project create`
Create a new project.

**Options:**
- `--name <name>` - **(Required)** Project name

**Example:**
```bash
node dist\cli.js project create --name "Production Workflows"
```

**Endpoint:** `/api/n8n/project_create`

---

### `project update`
Update a project name.

**Options:**
- `--id <id>` - **(Required)** Project ID
- `--name <name>` - **(Required)** New project name

**Example:**
```bash
node dist\cli.js project update --id proj123 --name "Staging Workflows"
```

**Endpoint:** `/api/n8n/project_update`

---

### `project delete`
Delete a project.

**Options:**
- `--id <id>` - **(Required)** Project ID

**Example:**
```bash
node dist\cli.js project delete --id proj123
```

**Endpoint:** `/api/n8n/project_delete`

---

## Utility Commands

General utility commands for middleware health and configuration.

### `health`
Check middleware health status.

**Example:**
```bash
node dist\cli.js health
```

**Endpoint:** `/api/health` (GET)

---

### `config`
Get current n8n configuration from middleware.

**Example:**
```bash
node dist\cli.js config
```

**Endpoint:** `/api/config` (GET)

---

### `test-connection`
Test connection to n8n instance.

**Example:**
```bash
node dist\cli.js test-connection
```

**Endpoint:** `/api/n8n/test_connection`

---

### `audit`
Generate security audit report.

**Options:**
- `--categories <cats>` - Categories: credentials,nodes,instance (comma-separated)

**Example:**
```bash
node dist\cli.js audit --categories "credentials,nodes"
```

**Endpoint:** `/api/n8n/securityaudit_generate`

---

### `source-control-pull`
Pull from source control.

**Options:**
- `--force` - Force pull

**Example:**
```bash
node dist\cli.js source-control-pull --force
```

**Endpoint:** `/api/n8n/sourcecontrol_pull`

---

## MCP Tools

This middleware also exposes tools via the MCP server (used by IDE agents). These are **not CLI commands**.

### `n8n_diagnose_workflow`

Run a workflow and return detailed diagnostics (polls until finished, then fetches the execution with `includeData=true`).

**Implementation:**
- MCP tool: `n8n-builder-agent/Agentic middleware controller/mcp-server/src/server.ts`
- Middleware endpoint: `/api/n8n/workflow_diagnose`

**Inputs:**
- `workflowId` - **(Required)** Workflow ID
- `data` - Input data object (optional)
- `wait` - Wait for execution to finish (default: true)
- `timeoutMs` - Max time to wait (default: 60000)
- `pollIntervalMs` - Polling interval (default: 1000)
- `ensureSaveData` - Try to temporarily enable workflow settings that help ensure execution data is saved (default: true)
- `restoreSettings` - Restore original workflow settings after diagnostics (default: true)
- `includeExecution` - Include the raw execution payload (default: false)

**Example payload (tool arguments):**
```json
{
  "workflowId": "coNSeCI5MUSTey1U",
  "data": {"key": "value"},
  "wait": true,
  "timeoutMs": 60000,
  "pollIntervalMs": 1000,
  "ensureSaveData": true,
  "restoreSettings": true,
  "includeExecution": false
}
```

**Output (high-level):**
- Execution ID, status, last node executed
- Error object and stack trace when available
- Failed node name/type when available
- `warnings[]` when settings could not be patched or polling timed out

---

## Complete Workflow Testing Example

Here's a complete example of testing all builder tools on the "Incident Triage" workflow:

```bash
# 1. Load workflow into state
node dist\cli.js builder load --id coNSeCI5MUSTey1U

# 2. View current nodes
node dist\cli.js builder list-nodes

# 3. Disconnect a connection
node dist\cli.js builder disconnect --from "LLM Analyze Incident" --to "Parse LLM Response"

# 4. Reconnect to different node (stdin JSON)
echo '[{"from":"LLM Analyze Incident","to":"Route By Severity"}]' | node dist\cli.js builder connect-batch --connections -

# 5. Configure node parameters (stdin JSON)
echo '[{"nodeName":"HTTP Request","parameters":{"url":"https://newapi.com"}}]' | node dist\cli.js builder configure-batch --configurations -

# 8. Remove a node
node dist\cli.js builder remove --name "Unused Node"

# 7. Add new nodes (stdin JSON)
echo '[{"nodeType":"n8n-nodes-base.httpRequest","name":"New API Call","parameters":{},"x":100,"y":200}]' | node dist\cli.js builder add-batch --nodes -

# 11. Update the remote workflow with changes
node dist\cli.js builder update-remote --id coNSeCI5MUSTey1U
```

---

## Notes

- All commands output JSON responses
- The middleware must be running on `http://localhost:3456` (configurable via `N8N_MIDDLEWARE_URL` env var)
- Builder commands maintain state in `.agent_multi_workflow_state.json`
- For complex JSON arguments in shells, prefer piping JSON via stdin with `-` (works well in PowerShell and avoids escaping issues)
- Schema sanitization automatically removes internal fields (like `webhookId`) when creating/updating workflows
