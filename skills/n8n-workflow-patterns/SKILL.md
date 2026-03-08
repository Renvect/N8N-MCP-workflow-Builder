---
name: n8n-workflow-patterns
description: Proven workflow architectural patterns from real n8n workflows. Use when building new workflows, designing workflow structure, choosing workflow patterns, planning workflow architecture, or asking about webhook processing, HTTP API integration, database operations, AI agent workflows, or scheduled tasks.
---

# n8n Workflow Patterns

Proven architectural patterns for building n8n workflows via the middleware.

---

## The 5 Core Patterns

Based on analysis of real workflow usage:

1. **Webhook Processing** (Most Common)
   - Receive HTTP requests → Process → Output
   - Pattern: Webhook → Validate → Transform → Respond/Notify

2. **HTTP API Integration**
   - Fetch from REST APIs → Transform → Store/Use
   - Pattern: Trigger → HTTP Request → Transform → Action → Error Handler

3. **Database Operations**
   - Read/Write/Sync database data
   - Pattern: Schedule → Query → Transform → Write → Verify

4. **AI Agent Workflow**
   - AI agents with tools and memory
   - Pattern: Trigger → AI Agent (Model + Tools + Memory) → Output

5. **Scheduled Tasks**
   - Recurring automation workflows
   - Pattern: Schedule → Fetch → Process → Deliver → Log

---

## Pattern Selection Guide

### When to use each pattern:

| Use Case | Pattern | Key Nodes |
|----------|---------|-----------|
| Receive webhooks from external services | Webhook Processing | Webhook, IF, Respond |
| Consume REST APIs | HTTP API Integration | HTTP Request, Set, Error Trigger |
| Sync between databases | Database Operations | Postgres/MySQL, Merge, Loop |
| Build AI assistants | AI Agent Workflow | AI Agent, Chat Model, Tools |
| Run recurring jobs | Scheduled Tasks | Schedule, Cron, Interval |

---

## Common Workflow Components

### 1. Triggers
| Type | Node | Use When |
|------|------|----------|
| HTTP | `n8n-nodes-base.webhook` | External systems send data |
| Manual | `n8n-nodes-base.manualTrigger` | Testing/on-demand |
| Schedule | `n8n-nodes-base.scheduleTrigger` | Recurring tasks |
| Event | App-specific triggers | App notifies of events |

### 2. Data Sources
| Type | Nodes |
|------|-------|
| APIs | HTTP Request, GraphQL |
| Databases | Postgres, MySQL, MongoDB |
| Apps | Slack, GitHub, Salesforce |
| Files | Read Binary, S3 |

### 3. Transformation
| Type | Nodes |
|------|-------|
| Mapping | Set, Edit Fields |
| Logic | IF, Switch, Merge |
| Format | Code, Function |
| Loop | Split In Batches, Loop Over Items |

### 4. Outputs
| Type | Nodes |
|------|-------|
| Notify | Slack, Email, Discord |
| Store | Database, Google Sheets |
| Respond | Respond to Webhook |
| API | HTTP Request (POST) |

### 5. Error Handling
| Type | Nodes |
|------|-------|
| Catch | Error Trigger |
| Retry | Retry on Fail (built-in) |
| Alert | Slack/Email on error |

---

## Pattern 1: Webhook Processing

### Description
Receive HTTP requests, validate, process, and respond.

### Implementation
```javascript
// 1. Initialize
n8n_init_workflow()

// 2. Get Schemas (CRITICAL!)
n8n_get_schema({ nodeType: "n8n-nodes-base.webhook" })
n8n_get_schema({ nodeType: "n8n-nodes-base.if" })

// 3. Add nodes
n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.webhook", name: "Webhook", x: 250, y: 300 },
    { nodeType: "n8n-nodes-base.if", name: "Validate", x: 450, y: 300 },
    { nodeType: "n8n-nodes-base.set", name: "Transform", x: 650, y: 200 },
    { nodeType: "n8n-nodes-base.respondToWebhook", name: "Success", x: 850, y: 200 },
    { nodeType: "n8n-nodes-base.respondToWebhook", name: "Error", x: 650, y: 400 }
  ]
})

// 3. Configure
n8n_configure_nodes_batch({
  configurations: [
    { 
      nodeName: "Webhook", 
      parameters: { 
        path: "process", 
        httpMethod: "POST",
        responseMode: "responseNode"
      }
    },
    { 
      nodeName: "Validate", 
      parameters: {
        conditions: {
          options: { caseSensitive: true },
          conditions: [{
            leftValue: "={{$json.body.type}}",
            rightValue: "valid",
            operator: { type: "string", operation: "equals" }
          }]
        }
      }
    },
    {
      nodeName: "Transform",
      parameters: {
        fields: {
          values: [{ name: "processed", value: "={{$json.body.data}}" }]
        }
      }
    }
  ]
})

// 4. Connect
n8n_connect_nodes_batch({
  connections: [
    { from: "Webhook", to: "Validate" },
    { from: "Validate", to: "Transform", outputIndex: 0 },
    { from: "Validate", to: "Error", outputIndex: 1 },
    { from: "Transform", to: "Success" }
  ]
})

// 5. Create
n8n_create_workflow_from_state({ name: "Webhook Processor" })
```

---

## Pattern 2: HTTP API Integration

### Description
Fetch data from external APIs, transform, and use.

### Implementation
```javascript
n8n_init_workflow()

// Always check schema first!
n8n_get_schema({ nodeType: "n8n-nodes-base.httpRequest" })

n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.scheduleTrigger", name: "Schedule", x: 250, y: 300 },
    { nodeType: "n8n-nodes-base.httpRequest", name: "Fetch API", x: 450, y: 300 },
    { nodeType: "n8n-nodes-base.set", name: "Transform", x: 650, y: 300 },
    { nodeType: "n8n-nodes-base.slack", name: "Notify", x: 850, y: 300 }
  ]
})

n8n_configure_nodes_batch({
  configurations: [
    { 
      nodeName: "Schedule", 
      parameters: { rule: { interval: [{ field: "hours", hoursInterval: 1 }] } }
    },
    { 
      nodeName: "Fetch API", 
      parameters: { 
        method: "GET",
        url: "={{$env.API_URL}}/data",
        authentication: "predefinedCredentialType",
        nodeCredentialType: "httpHeaderAuth"
      }
    },
    {
      nodeName: "Transform",
      parameters: {
        fields: {
          values: [
            { name: "count", value: "={{$json.results.length}}" },
            { name: "timestamp", value: "={{$now.toISO()}}" }
          ]
        }
      }
    },
    {
      nodeName: "Notify",
      parameters: {
        resource: "message",
        operation: "post",
        channel: "#updates",
        text: "={{\"Fetched \" + $json.count + \" records at \" + $json.timestamp}}"
      }
    }
  ]
})

n8n_connect_nodes_batch({
  connections: [
    { from: "Schedule", to: "Fetch API" },
    { from: "Fetch API", to: "Transform" },
    { from: "Transform", to: "Notify" }
  ]
})

n8n_create_workflow_from_state({ name: "API Integration" })
```

---

## Pattern 3: AI Agent Workflow

### Description
AI agent with language model, tools, and optional memory.

### Implementation
```javascript
n8n_init_workflow()

// Check schemas for AI nodes
n8n_get_schema({ nodeType: "@n8n/n8n-nodes-langchain.agent" })

n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.manualTrigger", name: "Trigger", x: 250, y: 300 },
    { nodeType: "@n8n/n8n-nodes-langchain.agent", name: "AI Agent", x: 500, y: 300 },
    { nodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi", name: "OpenAI", x: 500, y: 100 },
    { nodeType: "@n8n/n8n-nodes-langchain.toolHttpRequest", name: "HTTP Tool", x: 350, y: 500 },
    { nodeType: "@n8n/n8n-nodes-langchain.toolCalculator", name: "Calculator", x: 500, y: 500 },
    { nodeType: "n8n-nodes-base.set", name: "Output", x: 750, y: 300 }
  ]
})

n8n_configure_nodes_batch({
  configurations: [
    { 
      nodeName: "OpenAI", 
      parameters: { 
        model: "gpt-4o",
        options: { temperature: 0.7 }
      }
    },
    { 
      nodeName: "AI Agent", 
      parameters: { 
        promptType: "define",
        text: "You are a helpful assistant with access to web APIs and a calculator."
      }
    },
    {
      nodeName: "HTTP Tool",
      parameters: { description: "Make HTTP requests to external APIs" }
    },
    {
      nodeName: "Calculator",
      parameters: { description: "Perform mathematical calculations" }
    }
  ]
})

// Regular connection for trigger
n8n_connect_nodes_batch({
  connections: [
    { from: "Trigger", to: "AI Agent" },
    { from: "AI Agent", to: "Output" }
  ]
})

// AI subnode connections (special!)
n8n_connect_subnode({ from: "OpenAI", to: "AI Agent" })
n8n_connect_subnode({ from: "HTTP Tool", to: "AI Agent" })
n8n_connect_subnode({ from: "Calculator", to: "AI Agent" })

n8n_create_workflow_from_state({ name: "AI Assistant" })
```

---

## Pattern 4: Scheduled Task

### Description
Recurring automation with fetch, process, deliver pattern.

### Implementation
```javascript
n8n_init_workflow()

// Get schema
n8n_get_schema({ nodeType: "n8n-nodes-base.postgres" })

n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.scheduleTrigger", name: "Daily 9AM", x: 250, y: 300 },
    { nodeType: "n8n-nodes-base.postgres", name: "Query DB", x: 450, y: 300 },
    { nodeType: "n8n-nodes-base.code", name: "Generate Report", x: 650, y: 300 },
    { nodeType: "n8n-nodes-base.emailSend", name: "Send Email", x: 850, y: 300 }
  ]
})

n8n_configure_nodes_batch({
  configurations: [
    { 
      nodeName: "Daily 9AM", 
      parameters: { 
        rule: { 
          interval: [{ field: "cronExpression", cronExpression: "0 9 * * *" }] 
        }
      }
    },
    { 
      nodeName: "Query DB", 
      parameters: { 
        operation: "executeQuery",
        query: "SELECT * FROM orders WHERE date = CURRENT_DATE - 1"
      }
    },
    {
      nodeName: "Generate Report",
      parameters: {
        jsCode: `
const items = $input.all();
const total = items.reduce((sum, i) => sum + i.json.amount, 0);
return [{ json: { 
  reportDate: $now.toFormat('yyyy-MM-dd'),
  orderCount: items.length,
  totalAmount: total
}}];`
      }
    }
  ]
})

n8n_connect_nodes_batch({
  connections: [
    { from: "Daily 9AM", to: "Query DB" },
    { from: "Query DB", to: "Generate Report" },
    { from: "Generate Report", to: "Send Email" }
  ]
})

n8n_create_workflow_from_state({ name: "Daily Report" })
```

---

## Data Flow Patterns

### Linear Flow
```
Trigger → Process → Output
```

### Branching Flow
```
Trigger → IF → [True] → Action A
              → [False] → Action B
```

### Parallel Processing
```
Trigger → Merge (wait for all):
    ├→ API 1 →┤
    ├→ API 2 →┤
    └→ API 3 →┘
```

### Loop Pattern
```
Trigger → Split In Batches → Process → Loop → Aggregate
```

### Error Handler Pattern
```
Main Workflow: Trigger → Process (may fail)
Error Workflow: Error Trigger → Log → Notify
```

---

## Common Gotchas

### 1. Webhook Data Structure
```javascript
// ❌ Wrong
{{$json.email}}

// ✅ Correct
{{$json.body.email}}
```

### 2. Multiple Input Items
```javascript
// Code node - process all items
const items = $input.all();
// NOT $input.first() if you want all
```

### 3. Authentication Issues
- Always use credentials, not hardcoded tokens
- Test connections before building complex flows

### 4. Node Execution Order
- Nodes execute based on connection order
- Use Merge node to synchronize parallel paths

### 5. Expression Errors
- Check data structure with `n8n_list_nodes`
- Use optional chaining: `{{$json?.field}}`

---

## Best Practices

### ✅ Do
- Start with trigger → single action → verify
- Use Set node to define clear data structures
- Add error handling for production workflows
- Use environment variables for URLs and keys
- Name nodes descriptively

### ❌ Don't
- Build complex flows without testing parts
- Hardcode credentials or secrets
- Ignore error scenarios
- Create deeply nested conditional logic
- Skip node configuration

---

## Summary

| Pattern | Trigger | Key Nodes | Use For |
|---------|---------|-----------|---------|
| Webhook | Webhook | IF, Respond | External integrations |
| HTTP API | Schedule/Manual | HTTP Request | Data fetching |
| AI Agent | Manual/Webhook | Agent, Model, Tools | AI assistants |
| Scheduled | Schedule Trigger | DB, Email | Recurring jobs |
| Database | Schedule/Webhook | Postgres, Merge | Data sync |
