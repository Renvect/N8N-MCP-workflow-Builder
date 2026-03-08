---
name: n8n-expression-syntax
description: Validate n8n expression syntax and fix common errors. Use when writing n8n expressions, using {{}} syntax, accessing $json/$node variables, troubleshooting expression errors, or working with webhook data in workflows.
---

# n8n Expression Syntax

Expert guide for writing correct n8n expressions in workflows.

---

## Expression Format

All dynamic content in n8n uses **double curly braces**:

```
{{expression}}
```

**Examples:**
```
✅ {{$json.email}}
✅ {{$json.body.name}}
✅ {{$node["HTTP Request"].json.data}}
❌ $json.email  (no braces - treated as literal text)
❌ {$json.email}  (single braces - invalid)
```

---

## Core Variables

### $json - Current Node Output
Access data from the current node:

```javascript
{{$json.fieldName}}
{{$json['field with spaces']}}
{{$json.nested.property}}
{{$json.items[0].name}}
```

### $node - Reference Other Nodes
Access data from any previous node:

```javascript
{{$node["Node Name"].json.fieldName}}
{{$node["HTTP Request"].json.data}}
{{$node["Webhook"].json.body.email}}
```

**Important:**
- Node names **must** be in quotes
- Node names are **case-sensitive**
- Must match exact node name from workflow

### $now - Current Timestamp
Access current date/time:

```javascript
{{$now}}
{{$now.toFormat('yyyy-MM-dd')}}
{{$now.toFormat('HH:mm:ss')}}
{{$now.plus({days: 7})}}
```

### $env - Environment Variables
Access environment variables:

```javascript
{{$env.API_KEY}}
{{$env.DATABASE_URL}}
```

---

## 🚨 CRITICAL: Webhook Data Structure

**Most Common Mistake**: Webhook data is **NOT** at the root!

### Webhook Node Output Structure
```json
{
  "headers": { "content-type": "application/json" },
  "params": {},
  "query": {},
  "body": {
    "email": "user@example.com",    // <-- Your data is HERE
    "name": "John"
  }
}
```

### Correct Webhook Data Access
```javascript
// ❌ WRONG
{{$json.email}}

// ✅ CORRECT
{{$json.body.email}}
```

---

## Common Patterns

### Access Nested Fields
```javascript
{{$json.user.profile.email}}
{{$json.data.items[0].id}}
{{$json.response.results}}
```

### Reference Other Nodes
```javascript
{{$node["Webhook"].json.body.id}}
{{$node["HTTP Request"].json.data.name}}
{{$node["Set Fields"].json.processed}}
```

### Combine Variables
```javascript
{{"Hello " + $json.body.name}}
{{$json.firstName + " " + $json.lastName}}
{{"User ID: " + $node["Webhook"].json.body.id}}
```

---

## When NOT to Use Expressions

### ❌ Code Nodes
Inside Code nodes, use plain JavaScript:
```javascript
// In Code node - no {{}}
const email = $input.first().json.body.email;
return [{ json: { email: email } }];
```

### ❌ Webhook Paths
Webhook paths should be plain strings:
```
✅ /webhook/users
❌ /webhook/{{$json.path}}
```

### ❌ Credential Fields
Credential fields use their own syntax.

---

## Validation Rules

### 1. Always Use {{}}
```
✅ {{$json.email}}
❌ $json.email
```

### 2. Use Quotes for Spaces
```javascript
✅ {{$node["My Node"].json.data}}
❌ {{$node[My Node].json.data}}
```

### 3. Match Exact Node Names
```javascript
// If node is named "HTTP Request 1"
✅ {{$node["HTTP Request 1"].json.data}}
❌ {{$node["HTTP Request"].json.data}}
```

### 4. No Nested {{}}
```javascript
✅ {{"Value: " + $json.value}}
❌ {{"Value: {{$json.value}}"}}
```

---

## Common Mistakes

### Mistake 1: Missing Body Path
```javascript
// ❌ Wrong
{{$json.email}}

// ✅ Correct (for webhook data)
{{$json.body.email}}
```

### Mistake 2: Wrong Node Reference
```javascript
// ❌ Wrong - missing quotes
{{$node[Webhook].json.body}}

// ✅ Correct
{{$node["Webhook"].json.body}}
```

### Mistake 3: Typo in Node Name
```javascript
// ❌ Wrong - case mismatch
{{$node["webhook"].json.body}}

// ✅ Correct - exact match
{{$node["Webhook"].json.body}}
```

### Mistake 4: Array Access Error
```javascript
// ❌ Wrong - treating array as object
{{$json.items.id}}

// ✅ Correct - access array element
{{$json.items[0].id}}
```

---

## Quick Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `undefined` | Wrong path | Check actual data structure |
| `Cannot read property` | Null parent | Add null check or fix path |
| `is not a function` | Wrong method | Check method name |
| `Unexpected token` | Syntax error | Check braces and quotes |

---

## Working Examples

### Example 1: Webhook to Slack
```javascript
// Webhook receives: { "body": { "alert": "Server down", "severity": "high" } }

// Slack message text:
{{"🚨 Alert: " + $json.body.alert + " (Severity: " + $json.body.severity + ")"}}
```

### Example 2: HTTP Request to Email
```javascript
// HTTP Request returns: { "user": { "email": "test@example.com", "name": "John" } }

// Email subject:
{{"Welcome, " + $json.user.name + "!"}}

// Email to field:
{{$json.user.email}}
```

### Example 3: Format Timestamp
```javascript
// Current timestamp formatted
{{"Report generated: " + $now.toFormat('yyyy-MM-dd HH:mm')}}

// Date from data
{{$json.createdAt}}
```

---

## Data Type Handling

### Arrays
```javascript
{{$json.items[0]}}           // First item
{{$json.items.length}}       // Count
{{$json.items.map(i => i.name).join(", ")}}  // All names
```

### Objects
```javascript
{{$json.user.email}}         // Nested property
{{Object.keys($json)}}       // All keys
```

### Strings
```javascript
{{$json.name.toUpperCase()}}
{{$json.text.substring(0, 100)}}
{{$json.message.replace("old", "new")}}
```

### Numbers
```javascript
{{$json.price * 1.2}}        // Math
{{$json.count.toFixed(2)}}   // Formatting
{{Math.round($json.value)}}  // Rounding
```

---

## Advanced Patterns

### Conditional Content
```javascript
{{$json.status === "active" ? "✅ Active" : "❌ Inactive"}}
{{$json.items?.length > 0 ? $json.items[0].name : "No items"}}
```

### Date Manipulation
```javascript
{{$now.minus({days: 7}).toFormat('yyyy-MM-dd')}}
{{$now.plus({hours: 2})}}
{{$json.date ? DateTime.fromISO($json.date).toFormat('MMM dd') : 'N/A'}}
```

### String Manipulation
```javascript
{{$json.email.split('@')[0]}}
{{$json.name.trim()}}
{{$json.tags.join(', ')}}
```

---

## Best Practices

### ✅ Do
- Always test expressions in the Expression Editor first
- Use optional chaining (`?.`) for potentially null values
- Keep expressions simple - use Code node for complex logic
- Reference nodes by exact name
- Use `$json.body` for webhook payload data

### ❌ Don't
- Use expressions in Code nodes (use plain JS)
- Nest curly braces `{{  {{}}  }}`
- Hardcode secrets (use `$env`)
- Trust that data exists (add null checks)
- Use single braces `{}`

---

## Summary

| Variable | Purpose | Example |
|----------|---------|---------|
| `$json` | Current node data | `{{$json.email}}` |
| `$node["Name"]` | Other node data | `{{$node["Webhook"].json.body}}` |
| `$now` | Current timestamp | `{{$now.toFormat('yyyy-MM-dd')}}` |
| `$env` | Environment vars | `{{$env.API_KEY}}` |

**Remember:** Webhook data is in `$json.body`, not `$json`!
