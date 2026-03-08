# N8N Middleware Skills

Skills are knowledge files that teach AI agents how to use n8n middleware tools correctly. They provide patterns, best practices, and examples that help agents build workflows more reliably.

## Available Skills

| Skill | Description |
|-------|-------------|
| **n8n-middleware-tools** | Master guide for 62 MCP tools with usage patterns |
| **n8n-ai-connections** | AI Agent workflow wiring and subnode connections |
| **n8n-workflow-patterns** | 5 proven architectural patterns (webhook, API, AI, etc.) |
| **n8n-expression-syntax** | Expression writing and common mistakes |
| **n8n-node-configuration** | Operation-aware node configuration guidance |
| **n8n-validation-expert** | Error interpretation and fix strategies |

## How Skills Work

Skills complement MCP tools:
- **MCP tools** execute commands (create workflow, add node, etc.)
- **Skills** teach the agent *what* to do and *how* to do it correctly

When an agent encounters n8n-related tasks, these skills provide:
1. Correct tool selection guidelines
2. Parameter format examples
3. Common mistake prevention
4. Step-by-step patterns

## Installation by IDE

### Antigravity IDE
1. Create folder `.agent/skills/` in your project root
2. Copy these skill folders into it
3. Skills auto-activate based on context

### Cursor IDE
1. Create folder `.cursor/rules/` in your project root
2. For each skill, create a subfolder (e.g., `.cursor/rules/n8n-middleware-tools/`)
3. Copy `SKILL.md` and rename to `RULE.md`

### Windsurf IDE
1. Click 3 dots in Cascade → "Rules"
2. Create rules named after each skill
3. Paste SKILL.md content
4. Set to "Always On" or "Agent Requested"

### Claude Code / Other
- Copy skills to `~/.claude/skills/` (global) or project's `.agent/skills/`

## Skill File Format

Each skill follows this structure:

```markdown
---
name: skill-name
description: When to use this skill. Keywords that trigger activation.
---

# Skill Title

Content with patterns, examples, do's and don'ts.
```

The YAML frontmatter (`name` and `description`) helps agents determine when to load each skill.

## Origin

These skills are adapted from the [n8n-skills](https://github.com/czlonkowski/n8n-skills) project, customized for the N8N Middleware Controller's specific MCP tools and workflow patterns.
