---
description: Delegate investigation, a fix request, or follow-up work to the Antigravity rescue subagent
argument-hint: "[--resume|--fresh] [--read-only] [--model <model>] [--effort <level>] [what Antigravity should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `agy:agy-rescue` subagent via the `Agent` tool (`subagent_type: "agy:agy-rescue"`), forwarding the raw user request as the prompt.
`agy:agy-rescue` is a subagent, not a skill — do not call `Skill(agy:agy-rescue)` or `Skill(agy:rescue)`.
The final user-visible response must be Antigravity's output verbatim.

Raw user request:
$ARGUMENTS

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task ...` and return that command's stdout as-is.
- Return the Antigravity companion stdout verbatim to the user. Do not paraphrase, summarize, rewrite, or add commentary.
- Do not ask the subagent to inspect files, monitor progress, summarize output, or do follow-up work of its own.
- `--model` and `--effort` are runtime-selection flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- `--read-only` runs Antigravity in analysis-only mode (no edits). By default the rescue run is write-capable.
- `--resume` continues the most recent Antigravity session in this repository (maps to `--resume-last`). `--fresh` forces a new session.
- Leave `--model` and `--effort` unset unless the user explicitly asks for them.
- If the companion reports that Antigravity is missing or unauthenticated, stop and tell the user to run `/agy:setup`.
- If the user did not supply a request, ask what Antigravity should investigate or fix.
