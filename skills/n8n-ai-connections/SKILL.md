---
name: n8n-ai-connections
description: Expert guide for connecting AI subnodes in n8n workflows. Use when building AI Agent workflows, connecting language models, AI tools, memory nodes, output parsers, or any LangChain-based nodes. Provides correct connection types and wiring patterns.
---

# N8N AI Connections Expert

Specialized guide for wiring AI Agent workflows correctly in n8n.

---

## 🚨 CRITICAL: AI Subnodes Are Special

AI-related nodes (language models, tools, memory, output parsers) use **typed connections**, not standard main-to-main connections.

```javascript
// ❌ WRONG - Regular connection doesn't work for AI subnodes
n8n_connect_nodes_batch({
  connections: [{ from: "OpenAI Model", to: "AI Agent" }]
})

// ✅ CORRECT - Use the special subnode connection tool
n8n_connect_subnode({
  from: "OpenAI Model",
  to: "AI Agent"
})
```

---

## AI Connection Types

| Type | Description | Example Nodes |
|------|-------------|---------------|
| `ai_languageModel` | Chat/completion models | OpenAI, Anthropic, Ollama |
| `ai_tool` | Agent tools | HTTP Request Tool, Calculator |
| `ai_memory` | Conversation memory | Window Buffer, Postgres Chat |
| `ai_outputParser` | Response parsers | Structured Output Parser |
| `ai_retriever` | Vector retrievers | Pinecone, Supabase Vector |
| `ai_textSplitter` | Document splitters | Character Text Splitter |
| `ai_embedding` | Embedding models | OpenAI Embeddings |
| `ai_document` | Document loaders | PDF Loader, Text Loader |

---

## The `n8n_connect_subnode` Tool

### Basic Usage
```javascript
n8n_connect_subnode({
  from: "OpenAI Chat Model",    // Source node (the subnode)
  to: "AI Agent"                 // Target node (the parent)
})
// Type is automatically inferred from node schemas!
```

### Explicit Type Override
```javascript
n8n_connect_subnode({
  from: "Custom Model",
  to: "AI Agent",
  type: "ai_languageModel"       // Force specific connection type
})
```

### With Index Control
```javascript
n8n_connect_subnode({
  from: "Tool 1",
  to: "AI Agent",
  outputIndex: 0,                // Optional: output slot
  inputIndex: 0                  // Optional: input slot (auto-assigned by default)
})
```

---

## AI Agent Workflow Pattern

### Complete Example
```javascript
// 1. Initialize workflow
n8n_init_workflow()

// 2. Get Schemas (CRITICAL!)
n8n_get_schema({ nodeType: "@n8n/n8n-nodes-langchain.agent" })
n8n_get_schema({ nodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi" })

// 3. Add all nodes
n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.manualTrigger", name: "Trigger", x: 100, y: 300 },
    { nodeType: "@n8n/n8n-nodes-langchain.agent", name: "AI Agent", x: 400, y: 300 },
    { nodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi", name: "OpenAI", x: 400, y: 100 },
    { nodeType: "@n8n/n8n-nodes-langchain.toolHttpRequest", name: "HTTP Tool", x: 400, y: 500 }
  ]
})

// 3. Configure nodes
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
        text: "You are a helpful assistant."
      }
    },
    {
      nodeName: "HTTP Tool",
      parameters: {
        description: "Make HTTP requests to external APIs"
      }
    }
  ]
})

// 4. Connect trigger to agent (regular connection)
n8n_connect_nodes_batch({
  connections: [{ from: "Trigger", to: "AI Agent" }]
})

// 5. Connect AI subnodes (special connection!)
n8n_connect_subnode({ from: "OpenAI", to: "AI Agent" })
n8n_connect_subnode({ from: "HTTP Tool", to: "AI Agent" })

// 6. Create workflow
n8n_create_workflow_from_state({ name: "AI Agent with Tools" })
```

---

## Common AI Node Types

### Language Models
| Node Type | Package |
|-----------|---------|
| `lmChatOpenAi` | `@n8n/n8n-nodes-langchain` |
| `lmChatAnthropic` | `@n8n/n8n-nodes-langchain` |
| `lmChatOllama` | `@n8n/n8n-nodes-langchain` |
| `lmChatAzureOpenAi` | `@n8n/n8n-nodes-langchain` |
| `lmChatGoogleGemini` | `@n8n/n8n-nodes-langchain` |

### AI Tools
| Node Type | Purpose |
|-----------|---------|
| `toolHttpRequest` | HTTP API calls |
| `toolCode` | Execute JavaScript |
| `toolCalculator` | Math operations |
| `toolSerpApi` | Web search |
| `toolWorkflow` | Call other workflows |

### Memory Types
| Node Type | Storage |
|-----------|---------|
| `memoryBufferWindow` | In-memory (session) |
| `memoryPostgresChat` | PostgreSQL |
| `memoryRedisChat` | Redis |
| `memoryMotorhead` | Motorhead server |

---

## Multiple AI Connections

### Adding Multiple Tools
```javascript
// Each tool gets its own connection
n8n_connect_subnode({ from: "HTTP Tool", to: "AI Agent" })
n8n_connect_subnode({ from: "Calculator", to: "AI Agent" })
n8n_connect_subnode({ from: "Code Tool", to: "AI Agent" })
```

### Memory + Model + Tools
```javascript
// Model connection (required)
n8n_connect_subnode({ from: "OpenAI", to: "AI Agent" })

// Memory connection (optional)
n8n_connect_subnode({ from: "Buffer Memory", to: "AI Agent" })

// Tool connections (optional, can have multiple)
n8n_connect_subnode({ from: "HTTP Tool", to: "AI Agent" })
n8n_connect_subnode({ from: "Calculator", to: "AI Agent" })
```

---

## RAG (Retrieval-Augmented Generation) Pattern

### Vector Store Q&A
```javascript
// Nodes
n8n_add_nodes_batch({
  nodes: [
    { nodeType: "n8n-nodes-base.manualTrigger", name: "Trigger" },
    { nodeType: "@n8n/n8n-nodes-langchain.chainRetrievalQa", name: "QA Chain" },
    { nodeType: "@n8n/n8n-nodes-langchain.lmChatOpenAi", name: "OpenAI" },
    { nodeType: "@n8n/n8n-nodes-langchain.retrieverVectorStore", name: "Retriever" },
    { nodeType: "@n8n/n8n-nodes-langchain.vectorStorePinecone", name: "Pinecone" },
    { nodeType: "@n8n/n8n-nodes-langchain.embeddingsOpenAi", name: "Embeddings" }
  ]
})

// Regular connection
n8n_connect_nodes_batch({ connections: [{ from: "Trigger", to: "QA Chain" }] })

// AI subnode connections
n8n_connect_subnode({ from: "OpenAI", to: "QA Chain" })
n8n_connect_subnode({ from: "Retriever", to: "QA Chain" })
n8n_connect_subnode({ from: "Pinecone", to: "Retriever" })
n8n_connect_subnode({ from: "Embeddings", to: "Pinecone" })
```

---

## Connection Rules

### What Connects to What

| Parent Node | Accepts |
|-------------|---------|
| AI Agent | Models, Tools, Memory, Output Parsers |
| Chain (LLMChain) | Models, Output Parsers |
| QA Chain | Models, Retrievers |
| Retriever | Vector Stores |
| Vector Store | Embeddings |
| Text Splitter | Documents |

### Connection Limits

Some inputs have `maxConnections`:
- `ai_languageModel`: Usually 1 (one model per agent)
- `ai_tool`: Unlimited (multiple tools allowed)
- `ai_memory`: Usually 1 (one memory per agent)

The middleware automatically respects these limits.

---

## Troubleshooting

### Error: "Connection type mismatch"
**Cause:** Using wrong connection type or tool
```javascript
// Check what types a node accepts
n8n_get_schema({ nodeType: "@n8n/n8n-nodes-langchain.agent" })
// Look for "inputs" in the response
```

### Error: "Node not found"
**Cause:** Node name mismatch
```javascript
// List current nodes to get exact names
n8n_list_nodes()
// Use exact names from output
```

### Error: "Already connected"
**Cause:** Duplicate connection attempt
```javascript
// Check existing connections
n8n_list_nodes()  // Shows connections
// Disconnect first if needed
n8n_disconnect_nodes({ from: "OpenAI", to: "AI Agent" })
```

---

## Best Practices

### ✅ Do
- Use `n8n_connect_subnode` for ALL AI-related connections
- Let the middleware infer connection types automatically
- Add language model first, then tools, then memory
- Check schema with `n8n_get_schema` for unfamiliar nodes
- Position AI subnodes above (models) or below (tools) the parent

### ❌ Don't
- Use `n8n_connect_nodes_batch` for AI subnodes
- Hardcode connection types unless necessary
- Connect multiple models to one agent (usually limit of 1)
- Forget to configure credentials for external AI services
- Skip the model connection (AI Agent requires a model)

---

## Summary

**Key Rules:**
1. 🔗 Use `n8n_connect_subnode` for AI connections (NOT regular connect)
2. 🤖 AI Agent needs at minimum: Trigger → Agent ← Model
3. 🧰 Tools are optional but powerful - connect multiple with subnode
4. 🧠 Memory is optional - enables conversation history
5. 📊 RAG requires: Chain ← Model + Retriever ← VectorStore ← Embeddings
