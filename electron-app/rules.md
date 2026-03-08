# N8N Middleware Agent Rules (Cursor / Windsurf / Antigravity)

Authoritative policy for IDE agents working in this repository. These rules govern how workflows must be created, edited, and synchronized with n8n. The intent is to eliminate ad‑hoc/manual workflow construction and enforce the use of MCP and CLI tooling exposed by the middleware.

---

## Scope and Purpose
- Applies to all IDE agents (e.g., Cursor, Windsurf, Antigravity) operating in this codebase.
- Governs how agents create, edit, import, export, and update n8n workflows.
- Enforces middleware parity: agents must use MCP tools (via middleware) or the provided CLI, never direct n8n API calls or hand‑rolled JSON workflows.

---

## Hard Rules (Must / Must Not)

1) Workflow Creation and Updates
- MUST create/update workflows only through the stateful builder tools:
  - builder load → mutate state (add/configure/connect/remove) → builder update-remote
  - For new workflows: builder init → mutate state → builder create-from-state
- MUST NOT hand‑craft JSON workflow files and upload them via CLI.
- MUST NOT call n8n REST API directly. All calls must go through the middleware API (exposed by CLI or MCP tools).
- SHOULD prefer builder create-from-state over workflow create for new workflows (creation is permitted only via builder tools for IDE agents).

2) File and Artifact Creation
- MUST NOT write workflow JSON files to disk for the purpose of creating or updating workflows.
- MAY export state with builder save only when explicitly asked to produce an artifact for review or backup.

3) Networking and API Access
- MUST NOT send HTTP requests directly to the n8n server.
- MUST route all operations through the middleware: MCP endpoints (/api/mcp/…) or n8n endpoints (/api/n8n/…) only via the provided CLI or MCP tools.

4) Batch Operations and JSON Arguments
- SHOULD use builder commands that accept simple flags where possible.
- If a batch operation requires JSON arrays (add-batch, connect-batch, configure-batch), pass JSON inline or via stdin (`-`); DO NOT create files on disk for the JSON payload.
- If shell escaping prevents inline JSON, pipe JSON via stdin (recommended) or prefer breaking into smaller atomic builder commands instead of writing files.

5) Safety and Idempotence
- MUST read current state before destructive operations (use builder list-nodes and builder list-slots).
- MUST keep workflows in middleware state consistent; after changes, push with builder update-remote.
- MUST log actions in commit/PR descriptions referencing the exact CLI commands executed.

7) AI Agent Subnodes (Chat Models / Tools / Memory / Output Parsers)
- MUST connect AI-related subnodes to an agent/root AI node using: builder connect-subnode
- MUST NOT connect AI subnodes using a default main->main connection (this produces incorrect wiring).
- SHOULD omit --type so the middleware infers the correct ai_* connection type from schema.
- MAY specify --type / --input-type / --output-type only when certain of the correct ai_* slot.

6) Node Configuration (Mandatory)
- MUST configure all added nodes using builder configure-batch or equivalent before creating/updating workflow.
- MUST NOT create workflows with unconfigured nodes (empty parameters).
- MUST use builder get-schema-detail --node-type <type> to introspect valid parameters before configuring.
- SHOULD use environment variable expressions (e.g., `={{$env.API_URL}}`) for URLs and secrets, not hardcoded values.
- For HTTP Request nodes: MUST set method, url, authentication, headers, and body parameters as appropriate.
- For If/Switch nodes: MUST set conditions/rules with proper expressions referencing input data.
- For Webhook nodes: MUST set path, httpMethod, and responseMode.

---

## Approved Tools and When To Use Them

All operations must go through MCP parity endpoints in the middleware, invoked via:
- CLI: electron-app/dist/cli.js (preferred for IDE agents)

### 🔧 CLI Location & Usage

#### 🖥️ For Installed App (Run by User/Agent)
The `n8n-cli` command is available globally via the installation path.
- **Command:** `n8n-cli <command>`
- **Path:** If not in PATH, look in:
  - Windows: `%LOCALAPPDATA%\Programs\n8n-mcp-guardrail\n8n-cli.cmd` or `%PROGRAMFILES%\n8n-mcp-guardrail\n8n-cli.cmd`
  - Mac/Linux: `/usr/local/bin/n8n-cli` or `/opt/n8n-mcp-guardrail/n8n-cli`

#### 🛠️ For Development (Run from Source)
When running inside this repository, **ALWAYS use the absolute path** to avoid CWD errors:
- **Command:** `node "D:/n8nlibrary-main/n8n-builder-agent/Agentic middleware controller/electron-app/dist/cli.js" <command>`

**⚠️ IMPORTANT:**
Do not assume `node dist/cli.js` works from any folder. Use the explicit absolute path above or the global `n8n-cli` command.

- MCP: mcp-server tools (allowed when agent environment supports MCP tool calls)

Below is the authoritative mapping. Use the CLI command unless MCP call is explicitly requested.

### Stateful Builder (Primary Path)
- builder init
  - Purpose: Reset in-memory workflow state. Use before starting a brand-new build.
- builder load --id <workflowId> [--slot <name>]
  - Purpose: Import an existing n8n workflow into state for editing.
- builder list-nodes
  - Purpose: Inspect current nodes in the state; always check before/after mutations.
- builder add-batch --nodes <json>
  - Purpose: Add multiple nodes. Use inline JSON or split into repeated single-node additions if escaping is problematic.
- builder connect-batch --connections <json>
  - Purpose: Connect nodes. Prefer small, simple batches if shell escaping is troublesome.
- builder configure-batch --configurations <json>
  - Purpose: Configure node parameters in bulk. Keep payloads concise.
- builder disconnect --from <node> --to <node> [--output n] [--input n]
  - Purpose: Remove a specific connection precisely.
- builder disconnect-all-from --name <node>
  - Purpose: Clear all connections to/from a node prior to re‑wiring or removal.
- builder remove --name <node>
  - Purpose: Remove a single node from the state.
- builder remove-batch --names "A,B,C"
  - Purpose: Remove multiple nodes. Provide names comma‑separated.
- builder switch-slot --slot <name>
  - Purpose: Switch editing context across multiple workflows in memory.
- builder list-slots
  - Purpose: Audit all slots and their node counts.
- builder get-schema / builder get-schema-detail --node-type <type> [--property <prop>]
  - Purpose: Discover node capabilities and valid parameter schema.
- builder create-from-state --name <name>
  - Purpose: Create a new n8n workflow from the current state. This is the ONLY allowed creation path for IDE agents.
- builder update-remote --id <workflowId> [--slot <name>] [--name <name>]
  - Purpose: Push state changes back to an existing workflow. Use after edits.
- builder save --file <path> [--name <name>]
  - Purpose: Optional export for review/backup only. Do not use as an intermediate for creation.

### Workflow Admin (Read/Manage; creation via builder only)
- workflow list / workflow read --id <id>
  - Purpose: Discover IDs and inspect workflows.
- workflow update --id <id> [--name <name>] [--file <updates.json>]
  - Purpose: Minor metadata updates (e.g., rename). For structural changes prefer builder → update-remote.
- workflow run --id <id> [--data <json>]
  - Purpose: Trigger a manual execution.
- workflow activate / deactivate --id <id>
  - Purpose: Toggle activation (note: if method constraints exist, report and stop; do not hack around).
- workflow delete / move …
  - Purpose: Administrative operations. Confirm state before destructive actions.

### Other Admin Areas (Subject to License)
- execution list/read/retry/delete
- credential list/create/delete/move (read/write through middleware only; never store secrets in repo)
- tag list/create/read/update/delete; workflow-tags list/update
- variable list/create/update/delete (if licensed)
- user list/read/create/delete/change-role/enforce-mfa
- project list/create/update/delete (if licensed)
- audit, config, health, test-connection, source-control-pull (if licensed)

---

## Decision Guides (When To Use What)

1) “Create a new workflow from scratch”
- builder init → builder add/configure/connect → builder create-from-state
- DO NOT: prepare a JSON file and call workflow create.

2) “Edit an existing workflow (add nodes, change wiring, update params)”
- builder load --id <wfId> → builder add/configure/connect/remove → builder update-remote --id <wfId>
- Verify with builder list-nodes between steps.

3) “Rename a workflow or change metadata only”
- workflow update --id <wfId> --name "New Name"
- For structural edits, use the builder flow instead.

4) “Operate across multiple workflows at once”
- Use slots: builder load --slot <name>, builder switch-slot, builder list-slots

5) “Discover valid node parameters”
- builder get-schema or builder get-schema-detail --node-type <type>

---

## Prohibited Patterns (Fail‑Closed)
- Writing JSON workflow files solely to feed workflow create or update.
- Direct HTTP calls to n8n API endpoints from the IDE agent.
- Bypassing the middleware by importing third‑party SDKs or custom scripts.
- Modifying n8n internal files (e.g., n8n_agent_tool.js) unless explicitly requested.
- Committing secrets or raw credential payloads.

Agents encountering shell escaping constraints MUST either:
- Use multiple smaller builder operations; or
- Request human guidance for a one‑off, supervised approach.

---

## Compliance Checklist (What to include in PRs/Commits)
- Commands executed (exact CLI invocations) and rationale.
- Slot used and node count deltas (before → after) from builder list-slots/list-nodes.
- Whether builder update-remote or builder create-from-state was used.
- Any limitations encountered (e.g., license, HTTP 405) reported without workarounds.

---

## MCP Tool Reference (Parity Overview)
- n8n_init_workflow → builder init
- n8n_load_workflow_to_state → builder load
- n8n_list_nodes → builder list-nodes
- n8n_add_nodes_batch → builder add-batch
- n8n_connect_nodes_batch → builder connect-batch
- n8n_configure_nodes_batch → builder configure-batch
- n8n_disconnect_nodes → builder disconnect
- n8n_disconnect_all_from_node → builder disconnect-all-from
- n8n_remove_node → builder remove
- n8n_remove_nodes_batch → builder remove-batch
- n8n_save_workflow → builder save (export only)
- n8n_create_workflow_from_state → builder create-from-state (required for creation)
- n8n_workflow_update_from_state → builder update-remote (required for structural edits)
- n8n_switch_workflow_slot → builder switch-slot
- n8n_list_workflow_slots → builder list-slots
- n8n_get_schema → builder get-schema
- n8n_get_schema_detail → builder get-schema-detail

Administrative parity (read/ops via CLI; structural edits via builder):
- workflow list/read/update/run/activate/deactivate/delete/move
- execution list/read/retry/delete
- credential, tag, workflow-tags, variable (licensed), user, project (licensed), audit, config, health, test-connection, source-control-pull (licensed)

---

## Examples (Non‑exhaustive)

Create new workflow (allowed path):
```
node dist/cli.js builder init
echo '[{"nodeType":"n8n-nodes-base.manualTrigger","name":"Manual Trigger","x":250,"y":300}]' | node dist/cli.js builder add-batch --nodes -
node dist/cli.js builder create-from-state --name "My New Workflow"
```

Edit existing workflow and push:
```
node dist/cli.js builder load --id <WORKFLOW_ID>
node dist/cli.js builder disconnect --from "A" --to "B"
node dist/cli.js builder update-remote --id <WORKFLOW_ID>
```

Forbidden (do not do this):
```
# ❌ Writing a JSON file and using workflow create
node dist/cli.js workflow create --name "X" --file workflow.json

# ❌ Calling n8n REST directly
curl -X POST http://localhost:5678/rest/workflows …
```

---

## Enforcement
- IDE agents must adhere to this policy. If an operation appears blocked (HTTP method constraints, license limitations), the agent must stop and report, not improvise alternative paths.
- Reviews should reject PRs/changes that manually craft workflows or bypass the middleware.

---

This ruleset lives at: Agentic middleware controller/electron-app/rules.md
