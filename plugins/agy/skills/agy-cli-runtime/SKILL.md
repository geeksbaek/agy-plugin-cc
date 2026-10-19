---
name: agy-cli-runtime
description: Internal helper contract for calling the agy-companion runtime from Claude Code
user-invocable: false
---

# Antigravity Runtime

Use this skill only inside the `agy:agy-rescue` subagent.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" task "<raw arguments>"`

Execution rules:
- The rescue subagent is a forwarder, not an orchestrator. Its only job is to invoke `task` once and return that stdout unchanged.
- Prefer the helper over hand-rolled `git`, direct Antigravity CLI strings, or any other Bash activity.
- Do not call `setup`, `review`, or `adversarial-review` from `agy:agy-rescue`.
- Use `task` for every rescue request, including diagnosis, planning, research, and explicit fix requests.
- Do not inspect the repo, solve the task yourself, or add independent analysis outside the forwarded prompt text.

Flag handling:
- Use exactly one `task` invocation per rescue handoff.
- If the forwarded request includes `--model <name>`, pass it through to `task`.
- If the forwarded request includes `--effort <value>`, pass it through to `task`. agy validates the value against the selected model.
- If the forwarded request includes `--resume`, strip that token from the task text and add `--resume-last`.
- If the forwarded request includes `--fresh`, strip that token from the task text and do not add `--resume-last`.
- If the forwarded request includes `--read-only`, pass it through so Antigravity runs analysis-only.
- Default to a write-capable Antigravity run unless the user explicitly asks for read-only behavior.

Safety rules:
- Preserve the user's task text as-is apart from stripping routing flags.
- Do not monitor progress, summarize output, or do any follow-up work of your own.
- Return the stdout of the `task` command exactly as-is.
- If the Bash call fails or Antigravity cannot be invoked, return nothing.
