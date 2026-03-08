---
name: n8n-validation-expert
description: Interpret validation errors and guide fixing them. Use when encountering validation errors, validation warnings, false positives, workflow structure issues, or need help understanding validation results. Also use when asking about error types or the validation loop process.
---

# n8n Validation Expert

Expert guide for interpreting and fixing n8n workflow validation errors.

---

## Validation Philosophy

The middleware validates workflows to catch errors **before** they reach n8n:

1. **Schema Validation** - Node parameters match expected types/values
2. **Connection Validation** - Nodes are properly connected
3. **Expression Validation** - Expressions have valid syntax
4. **Reference Validation** - Referenced nodes exist

---

## Error Severity Levels

### 1. Errors (Must Fix)
Workflow will **not work** until fixed.

| Type | Example |
|------|---------|
| `missing_required` | Required field not set |
| `invalid_value` | Value outside allowed range |
| `invalid_reference` | Referenced node doesn't exist |
| `type_mismatch` | String where number expected |

### 2. Warnings (Should Fix)
Workflow may work but has issues.

| Type | Example |
|------|---------|
| `deprecated_field` | Using old parameter name |
| `missing_credential` | No credential configured |
| `unreachable_node` | Node not connected to flow |

### 3. Suggestions (Optional)
Improvements recommended.

| Type | Example |
|------|---------|
| `naming_convention` | Poor node naming |
| `unused_output` | Output not connected |

---

## Common Error Types

### 1. missing_required
**Problem:** A required field is not set.

**Example:**
```
Error: missing_required
Node: "HTTP Request"
Field: "url"
Message: "URL is required for HTTP Request node"
```

**Fix:**
```javascript
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "HTTP Request",
    parameters: {
      url: "https://api.example.com"  // Add the missing field
    }
  }]
})
```

### 2. invalid_value
**Problem:** Value doesn't match allowed options.

**Example:**
```
Error: invalid_value
Node: "HTTP Request"
Field: "method"
Value: "PATCH"
Allowed: ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS"]
```

**Fix:**
```javascript
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "HTTP Request",
    parameters: {
      method: "PUT"  // Use allowed value
    }
  }]
})
```

### 3. type_mismatch
**Problem:** Wrong data type provided.

**Example:**
```
Error: type_mismatch
Node: "Schedule"
Field: "interval"
Expected: number
Got: string "60"
```

**Fix:**
```javascript
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "Schedule",
    parameters: {
      interval: 60  // Number, not "60" string
    }
  }]
})
```

### 4. invalid_expression
**Problem:** Expression syntax is wrong.

**Example:**
```
Error: invalid_expression
Node: "Set"
Field: "value"
Expression: "{$json.email}"
Message: "Expressions must use double braces: {{}}"
```

**Fix:**
```javascript
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "Set",
    parameters: {
      value: "={{$json.email}}"  // Correct: ={{ }}
    }
  }]
})
```

### 5. invalid_reference
**Problem:** Referenced node doesn't exist.

**Example:**
```
Error: invalid_reference
Node: "Set"
Field: "value"
Expression: "={{$node['Old Name'].json.data}}"
Message: "Node 'Old Name' not found"
```

**Fix:**
```javascript
// Check actual node names
n8n_list_nodes()

// Update expression with correct name
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "Set",
    parameters: {
      value: "={{$node['Correct Name'].json.data}}"
    }
  }]
})
```

---

## The Validation Loop

When errors occur, follow this pattern:

```
1. Attempt operation (add/configure/connect)
2. If error returned:
   a. Read error message carefully
   b. Identify fix needed
   c. Apply fix
   d. Retry operation
3. Repeat until success
```

### Example
```javascript
// Attempt (may fail)
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "HTTP",
    parameters: { method: "FETCH" }  // Wrong value!
  }]
})

// Error returned: invalid_value, allowed: GET, POST, PUT, DELETE...

// Fix and retry
n8n_configure_nodes_batch({
  configurations: [{
    nodeName: "HTTP",
    parameters: { method: "GET" }  // Correct
  }]
})
```

---

## Auto-Sanitization

The middleware automatically fixes some issues:

### What It Fixes
- Trailing whitespace in strings
- Extra quotes around values
- Null vs undefined inconsistencies
- Boolean strings ("true" → true)

### What It CANNOT Fix
- Missing required fields
- Invalid enum values
- Wrong node references
- Broken expressions
- Connection type mismatches

---

## Recovery Strategies

### Strategy 1: Start Fresh
When heavily corrupted, reset and rebuild:

```javascript
n8n_init_workflow()
// Start adding nodes from scratch
```

### Strategy 2: Binary Search
For complex workflows, isolate the problem:

```javascript
// List all nodes
n8n_list_nodes()

// Remove half of suspectedproblematic nodes
n8n_remove_nodes_batch({ nodeNames: ["Node1", "Node2", "Node3"] })

// Test if error persists
// If yes, problem is in remaining nodes
// If no, problem was in removed nodes
```

### Strategy 3: Clean Stale Connections
Connection issues after node changes:

```javascript
// List nodes and connections
n8n_list_nodes()

// Disconnect all from problematic node
n8n_disconnect_all_from_node({ nodeName: "Problem Node" })

// Reconnect properly
n8n_connect_nodes_batch({...})
```

### Strategy 4: Check Schema
For configuration errors:

```javascript
// Get correct parameter options
n8n_get_schema({ nodeType: "n8n-nodes-base.httpRequest" })

// See full details
n8n_get_schema_detail({ 
  nodeType: "n8n-nodes-base.httpRequest",
  property: "authentication"
})
```

---

## Workflow Validation Errors

### Error: "Disconnected nodes"
**Cause:** Nodes not connected to workflow flow.

**Fix:**
```javascript
n8n_list_nodes()  // Check connections

n8n_connect_nodes_batch({
  connections: [{ from: "Trigger", to: "Disconnected Node" }]
})
```

### Error: "Circular connection"
**Cause:** Node connects back to itself/upstream.

**Fix:**
```javascript
// Disconnect the circular path
n8n_disconnect_nodes({ from: "Node A", to: "Node B" })

// Redesign flow to avoid circles
```

### Error: "Missing trigger"
**Cause:** Workflow has no trigger node.

**Fix:**
```javascript
n8n_add_nodes_batch({
  nodes: [{ 
    nodeType: "n8n-nodes-base.manualTrigger", 
    name: "Trigger",
    x: 100, y: 300
  }]
})

n8n_connect_nodes_batch({
  connections: [{ from: "Trigger", to: "First Node" }]
})
```

---

## Expression Error Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `undefined is not an object` | Wrong path | Check data structure |
| `Cannot read property X` | Parent is null | Use optional chaining `?.` |
| `X is not a function` | Method doesn't exist | Check method name |
| `Unexpected token` | Syntax error | Check braces/quotes |
| `Invalid left-hand side` | Assignment in expression | Use comparison instead |

---

## Best Practices

### ✅ Do
- Read error messages carefully - they tell you exactly what's wrong
- Check schema before configuring unfamiliar nodes
- Use `n8n_list_nodes` to verify current state
- Fix errors one at a time
- Start with simple configurations, then add complexity

### ❌ Don't
- Ignore warnings (they often become errors later)
- Guess parameter values without checking schema
- Make multiple changes at once (hard to debug)
- Assume expressions are correct without testing
- Skip validation steps

---

## Quick Reference

| Error Type | Quick Check | Quick Fix |
|------------|-------------|-----------|
| missing_required | Check schema for required fields | Add the field |
| invalid_value | Check schema for allowed values | Use allowed value |
| type_mismatch | Check expected type | Convert to correct type |
| invalid_expression | Check `={{}}` syntax | Fix expression format |
| invalid_reference | Check `n8n_list_nodes` output | Update reference |
| connection_error | Check node exists | Use `n8n_connect_subnode` for AI |

---

## Summary

**Validation Flow:**
1. 🔍 Read error message
2. 📋 Identify the problem (type, node, field)
3. 🔧 Apply the fix
4. ✅ Retry and verify

**Key Commands:**
- `n8n_list_nodes` - See current state
- `n8n_get_schema` - Check valid values
- `n8n_configure_nodes_batch` - Fix configuration
- `n8n_disconnect_nodes` - Fix connections
