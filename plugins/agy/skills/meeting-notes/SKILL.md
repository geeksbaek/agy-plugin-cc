---
name: meeting-notes
description: Generate meeting minutes from an audio recording with optional context and a requested output format using the Antigravity CLI multimodal audio support. Use when the user provides an audio file and asks for 회의록, meeting notes, minutes, transcript-derived decisions, action items, or formatted meeting summaries.
---

# Meeting Notes

Use Antigravity through the plugin companion so the audio file is passed as multimodal input.

Primary helper:
- `node "${CLAUDE_PLUGIN_ROOT}/scripts/agy-companion.mjs" meeting-notes --audio <audio-path> [--context-file <path>] [--format-file <path>] [--output-file <path>] [--model <model>] [--effort <level>] -- <additional context or format instructions>`

Execution rules:
- Prefer the helper over direct `agy` calls.
- Pass the audio path as an absolute path when available.
- Put stable background information in `--context-file` when it already exists; otherwise pass short context after `--`.
- Use `--format-file` when the user supplies a required minutes template or exact output format.
- Use `--output-file` only when the user asks for a saved artifact.
- Return the generated meeting minutes as-is unless the user asks for post-processing.

Minutes quality rules:
- Preserve decisions, action items, owners, deadlines, risks, and unresolved questions.
- Use the meeting language unless the user asks for another language.
- Do not invent unclear details. Mark unclear speakers, owners, dates, or deadlines as `미확인`.
- Follow the user's requested format exactly when one is provided.
