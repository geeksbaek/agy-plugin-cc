---
description: Check whether the local Antigravity CLI is installed and authenticated
argument-hint: ''
allowed-tools: Bash(node:*), Bash(agy:*), AskUserQuestion
---

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" setup --json
```

Output rules:
- Present the setup report to the user.
- If Antigravity is not installed, tell the user to install the Antigravity CLI, then rerun `/agy:setup`.
- If Antigravity is installed but not authenticated, tell the user to sign in through Antigravity, then rerun `/agy:setup`.
- If everything is ready, list the available models. If no default model is reported, say that agy uses its own configured default.
