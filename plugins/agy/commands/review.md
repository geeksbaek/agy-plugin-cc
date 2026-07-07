---
description: Run an Antigravity code review against local git state
argument-hint: '[--base <ref>] [--scope auto|working-tree|branch] [focus ...]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*)
---

Run an Antigravity code review through the plugin runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the review and return Antigravity's output verbatim to the user.

Argument handling:
- Preserve the user's arguments exactly.
- `--base <ref>` reviews the branch diff against that ref.
- `--scope auto|working-tree|branch` selects the review target. `auto` (default) picks the working tree when it is dirty, otherwise the branch diff against the detected default branch.
- Any remaining text after the flags is treated as the review focus and forwarded as-is.

Execution:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" review "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- After presenting the findings, STOP. Do not fix any issues. Ask the user which findings, if any, they want addressed before touching a single file.
- If the command reports that Antigravity is unavailable or unauthenticated, direct the user to `/agy:setup`.
