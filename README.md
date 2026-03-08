# Agentic Middleware Controller

> Desktop middleware that gives AI-powered IDEs (Cursor, Windsurf, Antigravity, Claude Code) **schema-driven n8n workflow building** capabilities via the Model Context Protocol (MCP).

---

## What It Does

The Agentic Middleware Controller runs locally on your machine and acts as a bridge between your AI IDE and a self-hosted n8n instance. It exposes **62 MCP tools** that let AI agents read, create, update, diagnose, and manage n8n workflows — all validated against real node schemas fetched directly from your n8n instance.

### Key Capabilities

- **Schema-Driven Workflow Building** — AI agents get the exact parameter schema for every n8n node, so they wire workflows correctly first time.
- **Full n8n API Coverage** — Workflows, executions, credentials, tags, variables, users, projects, source control, and security audits.
- **Stateful Workflow Builder** — Multi-slot in-memory workflow construction with batch add/connect/configure operations.
- **Ghost Pilot** — Embedded browser view for visual agent interaction with your n8n instance.
- **CLI Tool** — Full command-line interface for all middleware operations.
- **AI Skills System** — 6 knowledge files that teach AI agents n8n best practices, patterns, and expression syntax.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  YOUR PC (localhost)                                         │
│                                                              │
│  ┌────────────────────┐    ┌─────────────────────────────┐  │
│  │  Electron App       │    │  Your AI IDE                │  │
│  │  ├─ Config UI       │    │  (Cursor / Windsurf /       │  │
│  │  ├─ API Server :3456│◄───│   Antigravity / Claude)     │  │
│  │  ├─ MCP Server      │    │                             │  │
│  │  └─ Ghost Pilot     │    │  Connects via MCP protocol  │  │
│  └────────┬───────────┘    └─────────────────────────────┘  │
│            │                                                 │
│            ▼                                                 │
│  ┌─────────────────────┐                                    │
│  │  n8n Instance        │                                    │
│  │  (self-hosted)       │                                    │
│  └─────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Prerequisites & Dependencies

Before building from source, you need the following installed on your system:

### Required

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18+ | JavaScript runtime (includes npm) |
| **npm** | 9+ | Package manager (bundled with Node.js) |
| **Git** | 2.x+ | Version control |
| **TypeScript** | 5.3+ | Installed via npm (`npm i -g typescript`) |

### Optional (for Rust core)

| Tool | Version | Purpose |
|------|---------|---------|
| **Rust** | 1.70+ | Rust toolchain (`rustup`) |
| **Cargo** | 1.70+ | Rust package manager (bundled with Rust) |

### npm Dependencies (installed automatically via `npm install`)

#### Electron App (`electron-app/`)

**Runtime dependencies:**
- `bytenode` ^1.5.7 — V8 bytecode compilation
- `commander` ^11.1.0 — CLI framework
- `cors` ^2.8.5 — CORS middleware for Express
- `electron-updater` ^6.6.2 — Auto-update support
- `electron-store` ^8.1.0 — Persistent config storage
- `express` ^5.2.1 — HTTP API server

**Dev dependencies:**
- `electron` ^28.0.0 — Desktop framework
- `electron-builder` ^26.4.0 — Packaging & installer creation
- `@electron-forge/cli` ^7.2.0 — Forge build tooling
- `@electron-forge/maker-squirrel` ^7.2.0 — Windows installer maker
- `@electron-forge/maker-deb` ^7.2.0 — Debian package maker
- `@electron-forge/maker-zip` ^7.2.0 — ZIP archive maker
- `@electron/fuses` ^1.8.0 — Electron fuse configuration
- `typescript` ^5.3.0 — TypeScript compiler
- `@types/cors` ^2.8.19, `@types/express` ^5.0.6, `@types/node` ^20.10.0 — Type definitions

#### MCP Server (`mcp-server/`)

**Runtime dependencies:**
- `@modelcontextprotocol/sdk` ^1.25.2 — MCP protocol SDK

**Dev dependencies:**
- `typescript` ^5.3.0
- `ts-node` ^10.9.0
- `@types/node` ^20.10.0

### Rust Crate Dependencies (`rust-core/`)

| Crate | Version | Purpose |
|-------|---------|---------|
| `serde` | 1.0 (with `derive`) | Serialization/Deserialization |
| `serde_json` | 1.0 | JSON handling |
| `clap` | 4.0 (with `derive`) | CLI argument parsing |
| `uuid` | 1.0 (with `v4`) | UUID generation |
| `base64` | 0.21 | Base64 encoding/decoding |
| `thiserror` | 1.0 | Error type derive macros |

---

## Installation

### Option A: Download Installer (Recommended)

1. Download the latest `.exe` installer from the releases page.
2. Run the installer — it creates desktop and start-menu shortcuts automatically.
3. Launch **N8N MCP Guardrail** from the shortcut.

### Option B: Build from Source

```bash
# 1. Clone the repository
git clone <repo-url>
cd "Agentic middleware controller"

# 2. Build the MCP Server
cd mcp-server
npm install
npm run build
cd ..

# 3. Build the CLI
cd electron-app
npm install
npm run build:cli
cd ..

# 4. Build the Electron App
cd electron-app
npm run build

# 5. Create Windows installer (.exe)
npm run win:dist
```

The installer will be output to `electron-app/release/`.

---

## Setup & Configuration

1. **Launch** the desktop app.
2. **Enter your n8n instance details** in the Settings tab:
   - **Instance URL** — e.g. `http://localhost:5678` or `https://n8n.yourdomain.com`
   - **API Key** — Generated from n8n: Settings → API → Create API Key
   - **Email / Password** — Your n8n login credentials (used for Ghost Pilot auto-login)
3. Click **Connect** — the middleware starts the API server (port 3456) and MCP server.
4. Go to the **Integration Guides** tab and copy the MCP config JSON for your IDE.

---

## IDE Configuration

The app auto-generates the correct config JSON. Copy it from the **Integration Guides** tab.

### Cursor IDE

Paste into `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "n8n-agent": {
      "command": "node",
      "args": ["<path-from-app>"],
      "env": {
        "MIDDLEWARE_URL": "http://localhost:3456"
      }
    }
  }
}
```

### Windsurf IDE

Paste into `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "n8n-agent": {
      "command": "node",
      "args": ["<path-from-app>"],
      "env": {
        "MIDDLEWARE_URL": "http://localhost:3456"
      }
    }
  }
}
```

### Antigravity IDE

Paste into `~/.gemini/antigravity/mcp_config.json`:

```json
{
  "mcpServers": {
    "n8n-agent": {
      "command": "node",
      "args": ["<path-from-app>"],
      "env": {
        "MIDDLEWARE_URL": "http://localhost:3456"
      }
    }
  }
}
```

> **Note:** The `<path-from-app>` is automatically populated with your correct local path when you copy from the app UI.

---

## AI Skills Setup

Skills are knowledge files that teach AI agents how to use the middleware correctly. The app ships with **6 skills**:

| Skill | Purpose |
|-------|---------|
| `n8n-middleware-tools` | Master guide for all 62 MCP tools |
| `n8n-ai-connections` | AI Agent workflow wiring and subnode connections |
| `n8n-workflow-patterns` | 5 proven architectural patterns |
| `n8n-expression-syntax` | Expression writing and common mistakes |
| `n8n-node-configuration` | Operation-aware node configuration |
| `n8n-validation-expert` | Error interpretation and fix strategies |

### Installing Skills

- **Antigravity:** Copy skill folders to `.agent/skills/` in your project root.
- **Cursor:** Copy to `.cursor/rules/`, rename `SKILL.md` → `RULE.md`.
- **Windsurf:** Cascade → 3 dots → Rules → Create rules named after each skill, paste content, set to "Always On".
- **Claude Code:** Copy to `~/.claude/skills/` or project `.agent/skills/`.

Use the **AI Skills** tab in the app to open the skills folder and copy content.

---

## CLI Reference

The CLI communicates with the middleware API on `http://127.0.0.1:3456`.

### Workflow Management

```bash
n8n-cli workflow list                          # List all workflows
n8n-cli workflow read <id>                     # Read workflow by ID
n8n-cli workflow create --json <file>          # Create from JSON file
n8n-cli workflow update <id> --json <file>     # Update existing workflow
n8n-cli workflow run <id>                      # Execute a workflow
n8n-cli workflow diagnose <id>                 # Diagnose execution issues
n8n-cli workflow activate <id>                 # Activate workflow
n8n-cli workflow deactivate <id>               # Deactivate workflow
n8n-cli workflow delete <id>                   # Delete workflow
n8n-cli workflow move <id> --project <pid>     # Move to project
```

### Stateful Workflow Builder

```bash
n8n-cli builder init                           # Initialize empty workflow state
n8n-cli builder add-batch --json <nodes>       # Add nodes in batch
n8n-cli builder connect-batch --json <conns>   # Connect nodes in batch
n8n-cli builder configure-batch --json <cfg>   # Configure nodes in batch
n8n-cli builder list-nodes                     # List nodes in current state
n8n-cli builder remove <name>                  # Remove a node
n8n-cli builder save --file <path>             # Save state to JSON file
n8n-cli builder create-from-state              # Create workflow in n8n from state
n8n-cli builder update-remote <id>             # Update existing n8n workflow from state
n8n-cli builder load <id>                      # Load n8n workflow into state
n8n-cli builder get-schema <nodeType>          # Get node schema
n8n-cli builder get-schema-detail <type> <op>  # Get detailed schema for operation
```

### Tags, Variables & Users

```bash
n8n-cli tags list | create | read | update | delete
n8n-cli variables list | create | update | delete
n8n-cli users list | read | create | delete | change-role | enforce-mfa
n8n-cli projects list | create | update | delete
```

### Utility

```bash
n8n-cli health                                 # Check middleware + n8n health
n8n-cli config                                 # Show current config
n8n-cli test-connection                        # Test n8n connectivity
n8n-cli audit                                  # Run security audit
n8n-cli source-control-pull                    # Pull from source control
```

### Ghost Pilot (Vision)

```bash
n8n-cli vision tree                            # Get DOM accessibility tree
n8n-cli vision click <selector>                # Click an element
n8n-cli vision type <selector> <text>          # Type into an element
n8n-cli vision eval <js>                       # Execute JavaScript
n8n-cli vision screenshot                      # Capture screenshot
```

---

## Available MCP Tools (62)

| Category | Tools |
|----------|-------|
| **Workflow CRUD** | `n8n_list_workflows`, `n8n_read_workflow`, `n8n_create_workflow`, `n8n_update_workflow`, `n8n_delete_workflow`, `n8n_activate_workflow`, `n8n_deactivate_workflow`, `n8n_move_workflow` |
| **Executions** | `n8n_list_executions`, `n8n_read_execution`, `n8n_delete_execution`, `n8n_retry_execution`, `n8n_execute_workflow`, `n8n_diagnose_workflow` |
| **Builder** | `n8n_init_workflow`, `n8n_load_workflow_to_state`, `n8n_add_nodes_batch`, `n8n_connect_nodes_batch`, `n8n_configure_nodes_batch`, `n8n_list_nodes`, `n8n_remove_node`, `n8n_remove_nodes_batch`, `n8n_disconnect_nodes`, `n8n_disconnect_all_from_node`, `n8n_save_workflow`, `n8n_create_workflow_from_state`, `n8n_workflow_update_from_state` |
| **Schema** | `n8n_get_schema`, `n8n_get_schema_detail` |
| **Tags** | `n8n_list_tags`, `n8n_create_tag`, `n8n_read_tag`, `n8n_update_tag`, `n8n_delete_tag`, `n8n_list_workflow_tags`, `n8n_update_workflow_tags` |
| **Variables** | `n8n_list_variables`, `n8n_create_variable`, `n8n_update_variable`, `n8n_delete_variable` |
| **Credentials** | `n8n_list_credentials` |
| **Users** | `n8n_list_users`, `n8n_read_user`, `n8n_create_user`, `n8n_delete_user`, `n8n_change_role`, `n8n_enforce_mfa` |
| **Projects** | `n8n_list_projects`, `n8n_create_project`, `n8n_update_project`, `n8n_delete_project` |
| **Audit & Source Control** | `n8n_security_audit`, `n8n_source_control_pull` |
| **Vision (Ghost Pilot)** | `n8n_browser_action` |

---

## Project Structure

```
Agentic middleware controller/
├── electron-app/           # Desktop application (Electron)
│   ├── src/
│   │   ├── main.ts         # Main process — window, IPC, services
│   │   ├── preload.ts      # Secure IPC bridge to renderer
│   │   ├── api-server.ts   # Express HTTP API (port 3456)
│   │   ├── cli.ts          # CLI tool (commander-based)
│   │   ├── cdp-client.ts   # Chrome DevTools Protocol client
│   │   └── updater.ts      # Auto-update logic
│   ├── renderer/
│   │   ├── index.html      # App UI
│   │   ├── renderer.js     # UI logic
│   │   └── updater-ui.js   # Update UI handlers
│   └── package.json
├── mcp-server/             # MCP protocol server
│   └── src/
│       └── server.ts       # Tool definitions & stdio transport
├── rust-core/              # Optional Rust core (schema builder)
│   ├── Cargo.toml
│   └── src/
├── skills/                 # AI skill knowledge files
│   ├── n8n-middleware-tools/
│   ├── n8n-ai-connections/
│   ├── n8n-workflow-patterns/
│   ├── n8n-expression-syntax/
│   ├── n8n-node-configuration/
│   └── n8n-validation-expert/
├── .gitignore
├── LICENSE                 # Elastic License 2.0 (ELv2)
└── README.md               # This file
```

---

## Cloud Version

A managed cloud version of this middleware is planned for future release. It will provide:

- Hosted MCP endpoint (no local install needed)
- Team collaboration and shared configurations
- Usage analytics and workflow insights
- Priority support

For cloud access or enterprise inquiries, contact: **n8nlibrary.net**

---

## License

This software is provided under the **Elastic License 2.0 (ELv2)**.

- **Free to use** for any purpose (personal, commercial, internal).
- **No modification** of the source code is permitted.
- **No offering as a hosted service** to third parties.

See [LICENSE](./LICENSE) for full terms.
