---
description: Generate meeting minutes from an audio recording using Antigravity multimodal input
argument-hint: "[--audio <path>] [--context-file <path>] [--format-file <path>] [--output-file <path>] [--model <model>] <audio-path> [additional context or format instructions]"
disable-model-invocation: true
allowed-tools: Bash(node:*), Bash(agy:*)
---

Generate meeting minutes through the Antigravity plugin runtime.

Raw slash-command arguments:
`$ARGUMENTS`

Argument handling:
- Preserve the user's arguments exactly.
- The audio file can be passed as `--audio <path>` or as the first positional argument.
- `--context-file <path>` points to optional project/team/context notes.
- `--format-file <path>` points to the exact output format to follow.
- Remaining positional text is additional context and may include a requested output format.
- `--output-file <path>` writes the generated minutes to that file as well as printing them.

Execution:
- Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" meeting-notes "$ARGUMENTS"
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary before or after it.
- If the command reports that Antigravity is unavailable or unauthenticated, direct the user to `/agy:setup`.
