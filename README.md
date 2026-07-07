# agy-plugin-cc

Use the Antigravity CLI (`agy`) from Claude Code to review code, delegate tasks, or generate meeting minutes from audio.

This is a port of [`openai/codex-plugin-cc`](https://github.com/openai/codex-plugin-cc) in the same style as the local `grok-plugin-cc`. The Codex version relies on the `codex app-server` JSON-RPC transport and a shared broker process; Antigravity has a different CLI surface, so this port uses single-turn `agy --print` subprocess calls.

## Requirements

- Node.js 18.18 or newer
- The `agy` CLI installed and on your `PATH`
- Antigravity signed in and able to run `agy models`

Check readiness at any time with `/agy:setup`.

## Commands

| Command | What it does |
| --- | --- |
| `/agy:setup` | Report whether the Antigravity CLI is installed, signed in, and listing models. |
| `/agy:review` | Run a read-only code review against local git state and return structured findings. |
| `/agy:rescue` | Delegate an investigation or fix to Antigravity through the `agy-rescue` subagent. |
| `/agy:meeting-notes` | Generate formatted meeting minutes from an audio file plus optional context. |

### `/agy:review`

```text
/agy:review [--base <ref>] [--scope auto|working-tree|branch] [focus ...]
```

- `--scope auto` (default): reviews the working tree when it is dirty, otherwise the branch diff against the detected default branch.
- `--base <ref>`: reviews the branch diff against an explicit ref.
- Trailing text is passed to Antigravity as the review focus.

The command asks Antigravity for JSON matching `schemas/review-output.schema.json` and renders findings ordered by severity.

### `/agy:rescue`

```text
/agy:rescue [--resume|--fresh] [--read-only] [--model <model>] <request>
```

Forwards the request to a thin `agy-rescue` subagent that calls the companion `task` runtime once and returns Antigravity's output verbatim. Write-capable runs use `--dangerously-skip-permissions`; pass `--read-only` to use `--sandbox`. `--resume` continues the most recent Antigravity conversation in the repository.

### `/agy:meeting-notes`

```text
/agy:meeting-notes [--audio <path>] [--context-file <path>] [--format-file <path>] [--output-file <path>] [--model <model>] <audio-path> [additional context or format instructions]
```

- The audio file can be passed as `--audio <path>` or as the first positional argument.
- `--context-file` supplies stable background information such as attendees, project names, agenda, or vocabulary.
- `--format-file` supplies the exact output format to follow.
- Remaining positional text is treated as additional context and may include format instructions.
- `--output-file` saves the generated minutes while still printing them.

The companion passes the audio as an `@/absolute/path` reference so Antigravity can use multimodal audio input directly.

## Installation

Add this repository as a Claude Code plugin marketplace, then install the `agy` plugin:

```text
/plugin marketplace add geeksbaek/agy-plugin-cc
/plugin install agy@agy
/agy:setup
```

## How It Works

Every command shells out to `plugins/agy/scripts/agy-companion.mjs`, which invokes `agy` in headless mode and reads the JSON `response` field:

- `setup`: `agy --version` and `agy models`
- `review`: `agy --sandbox --output-format json --print <prompt-file-reference>`
- `task`: `agy --output-format json --print <prompt-file-reference>` with either `--sandbox` or `--dangerously-skip-permissions`
- `meeting-notes`: `agy --sandbox --output-format json --print <prompt-file-reference>` with the audio path embedded as `@/path/to/audio`

When no `--model` is passed, Antigravity uses its configured default. Override per invocation with `--model <name>` or set `AGY_DEFAULT_MODEL`.

## License

Apache-2.0. Derived from `openai/codex-plugin-cc` (Apache-2.0) and the local `grok-plugin-cc` port. See `LICENSE` and `NOTICE`.
