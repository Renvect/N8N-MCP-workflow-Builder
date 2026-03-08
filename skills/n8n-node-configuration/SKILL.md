---
name: n8n-node-configuration
description: Operation-aware node configuration guidance. Use when configuring nodes, understanding property dependencies, determining required fields, choosing between get_node detail levels, or learning common configuration patterns by node type.
---

# n8n Node Configuration

Expert guide for correctly configuring n8n nodes via the middleware.

---

## Configuration Philosophy

**Not all fields are always required** - it depends on the operation!

The same node type may need different fields depending on:
- Which **resource** you're working with
- Which **operation** you're performing
- What **options** you've enabled

---

## Core Concepts

### 1. Operation-Aware Configuration
```javascript
// Slack node - operation='post'
{
  "resource": "message",
  "operation": "post",
  "channel": "#general",  // Required for post
  "text": "Hello!"        // Required for post
}

// Slack node - operation='update'
{
  "resource": "message",
  "operation": "update",
  "messageId": "123",     // Required for update (different!)
  "text": "Updated!"      // Required for update
  // channel NOT required for update
}
```

**Key**: Resource + operation determine which fields are required!

### 2. Property Dependencies
Fields appear/disappear based on other field values:

```javascript
// When method='GET'
{
  "method": "GET",
  "url": "https://api.example.com"
  // sendBody not needed (GET doesn't have body)
}

// When method='POST'
{
  "method": "POST",
  "url": "https://api.example.com",
  "sendBody": true,       // Now needed!
  "body": {               // Required when sendBody=true
    "contentType": "json",
    "content": {...}
  }
}
```

### 3. Progressive Discovery
Use the right level of detail:

1. **`n8n_get_schema`** - Quick overview
2. **`n8n_get_schema_detail`** - Full schema with all properties

```javascript
// Start with basic schema
n8n_get_schema({ nodeType: "n8n-nodes-base.httpRequest" })

// If need more details
n8n_get_schema_detail({ nodeType: "n8n-nodes-base.httpRequest" })

// For specific property
n8n_get_schema_detail({ 
  nodeType: "n8n-nodes-base.httpRequest",
  property: "authentication"
})
```

---

## Configuration Workflow

### Standard Process
```
1. Check schema → n8n_get_schema
2. Add node → n8n_add_nodes_batch
3. Configure → n8n_configure_nodes_batch
4. Verify → n8n_list_nodes
```

### Example: Configuring HTTP Request
```javascript
// 1. Check what parameters are available
n8n_get_schema({ nodeType: "n8n-nodes-base.httpRequest" })

// 2. Add the node
n8n_add_nodes_batch({
  nodes: [{ nodeType: "n8n-nodes-base.httpRequest", name: "Call API", x: 400, y: 300 }]
})

// 3. Configure based on schema knowledge
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "Call API",
    parameters: {
      method: "POST",
      url: "={{$env.API_URL}}/endpoint",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "httpHeaderAuth",
      sendBody: true,
      bodyContentType: "json",
      jsonBody: '={"key": "{{$json.value}}"}'
    }
  }]
})
```

---

## Common Node Patterns

### Pattern 1: Resource/Operation Nodes
Nodes like Slack, GitHub, Google Sheets use resource/operation pattern:

```javascript
// Slack - Post message
{
  "resource": "message",
  "operation": "post",
  "channel": "#channel",
  "text": "message"
}

// Slack - Upload file
{
  "resource": "file",
  "operation": "upload",
  "channelId": "C123456",
  "binaryData": true
}
```

### Pattern 2: HTTP-Based Nodes
HTTP Request and similar nodes:

```javascript
// GET request
{
  "method": "GET",
  "url": "https://api.example.com/data"
}

// POST with JSON body
{
  "method": "POST",
  "url": "https://api.example.com/data",
  "sendBody": true,
  "bodyContentType": "json",
  "jsonBody": '{"name": "value"}'
}

// With authentication
{
  "method": "GET",
  "url": "https://api.example.com",
  "authentication": "predefinedCredentialType",
  "nodeCredentialType": "httpHeaderAuth"
}
```

### Pattern 3: Database Nodes
Postgres, MySQL, MongoDB:

```javascript
// Execute query
{
  "operation": "executeQuery",
  "query": "SELECT * FROM users WHERE id = $1",
  "additionalFields": {
    "queryParams": "={{[$json.userId]}}"
  }
}

// Insert
{
  "operation": "insert",
  "table": "users",
  "columns": "name,email"
}
```

### Pattern 4: Conditional Logic Nodes
IF, Switch:

```javascript
// IF node
{
  "conditions": {
    "options": { "caseSensitive": true },
    "conditions": [{
      "leftValue": "={{$json.status}}",
      "rightValue": "active",
      "operator": { "type": "string", "operation": "equals" }
    }]
  }
}

// Switch node
{
  "mode": "expression",
  "expression": "={{$json.type}}",
  "rules": {
    "values": [
      { "value": "type1" },
      { "value": "type2" }
    ]
  }
}
```

---

## Common Node Configurations

### Webhook Node
```javascript
{
  "path": "webhook-path",
  "httpMethod": "POST",
  "responseMode": "responseNode",  // or "onReceived"
  "responseData": "firstEntryJson"
}
```

### Respond to Webhook Node
```javascript
{
  "respondWith": "json",
  "responseBody": '={"success": true, "data": {{$json}}}'
}
```

### Set/Edit Fields Node
```javascript
{
  "fields": {
    "values": [
      { "name": "newField", "value": "={{$json.sourceField}}" },
      { "name": "static", "value": "constant value" }
    ]
  }
}
```

### Code Node (JavaScript)
```javascript
{
  "jsCode": `
const items = $input.all();
const result = items.map(item => ({
  json: {
    processed: item.json.value * 2
  }
}));
return result;
  `
}
```

### Email Send Node
```javascript
{
  "fromEmail": "sender@example.com",
  "toEmail": "={{$json.email}}",
  "subject": "={{\"Report for \" + $now.toFormat('yyyy-MM-dd')}}",
  "html": "={{$json.reportHtml}}"
}
```

---

## Property Dependencies

### How displayOptions Works

Properties show/hide based on other field values:

```javascript
// The 'jsonBody' field only shows when:
displayOptions: {
  show: {
    sendBody: [true],
    bodyContentType: ['json']
  }
}
```

This means you need to set parent fields first!

### Common Dependency Patterns

| Parent Field | Value | Shows |
|--------------|-------|-------|
| `sendBody` | `true` | Body options |
| `bodyContentType` | `json` | JSON body field |
| `authentication` | `predefinedCredentialType` | Credential selector |
| `responseMode` | `responseNode` | Response node required |

---

## Configuration Anti-Patterns

### ❌ Don't: Over-configure Upfront
```javascript
// Don't set fields that may not be needed yet
{
  "method": "GET",
  "sendBody": true,  // Not needed for GET!
  "bodyContentType": "json"  // Unnecessary
}
```

### ❌ Don't: Skip Validation
```javascript
// Don't assume you know the schema
n8n_add_nodes_batch({...})
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "Unknown Node",
    parameters: { someGuess: "value" }  // May not exist!
  }]
})

// Check schema first
n8n_get_schema({ nodeType: "..." })
```

### ❌ Don't: Ignore Operation Context
```javascript
// Wrong - channel needed for post, not update
{
  "resource": "message",
  "operation": "update",
  "channel": "#general",  // Not needed here!
  "messageId": "123",
  "text": "Updated"
}
```

---

## Best Practices

### ✅ Do
- Check schema before configuring unfamiliar nodes
- Set resource/operation first, then required fields
- Use environment variables for URLs and sensitive data
- Verify configuration with `n8n_list_nodes`
- Test with simple values before adding expressions

### ❌ Don't
- Guess parameter names without checking schema
- Hardcode credentials or secrets
- Over-configure (only set what's needed for the operation)
- Skip required fields (causes workflow errors)
- Mix expression syntax in Code nodes

---

## Troubleshooting

### Error: "Missing required field"
**Cause:** Operation requires field not set
```javascript
// Check schema for required fields
n8n_get_schema_detail({ nodeType: "...", property: "..." })
```

### Error: "Invalid value"
**Cause:** Value doesn't match expected type/format
```javascript
// Check allowed values in schema
n8n_get_schema({ nodeType: "..." })
// Look for "options" or "enum" in response
```

### Error: "Expression error"
**Cause:** Invalid expression syntax
```javascript
// ❌ Wrong in parameter value
{"field": "{{wrong}}"}

// ✅ Correct
{"field": "={{$json.value}}"}  // Note the =
```

---

## Summary

| Concept | Key Point |
|---------|-----------|
| **Resource/Operation** | Determines which fields are required |
| **Dependencies** | Parent field values show/hide child fields |
| **Schema First** | Always check `n8n_get_schema` before configuring |
| **Expressions** | Use `=` prefix: `"={{$json.field}}"` |
| **Credentials** | Use `authentication` + `nodeCredentialType` |
