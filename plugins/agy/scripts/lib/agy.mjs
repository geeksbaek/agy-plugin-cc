import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createTempDir } from "./fs.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

// Antigravity CLI executable. Overridable for testing via AGY_BIN.
export const AGY_BIN = process.env.AGY_BIN || "agy";

// Optional model used when the caller does not pass --model. Model ids change
// between Antigravity releases, so nothing is hardcoded: when AGY_DEFAULT_MODEL
// is unset (or names a model `agy models` no longer lists), --model is omitted
// and agy uses its own configured default.
export const DEFAULT_MODEL = process.env.AGY_DEFAULT_MODEL || null;

const READ_ONLY_ARGS = ["--sandbox"];
const WRITE_CAPABLE_ARGS = ["--dangerously-skip-permissions"];
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const PRINT_TIMEOUT = process.env.AGY_PRINT_TIMEOUT || "10m0s";

export function getAntigravityAvailability(cwd) {
  return binaryAvailable(AGY_BIN, ["--version"], { cwd });
}

/**
 * Parse `agy models` output. Progress text ("Fetching available models...")
 * goes to stderr; stdout lists one model per line as `<model-id>\t<label>`.
 * Only the id column is kept so the list stays usable for --model.
 */
export function getAntigravityAuthStatus(cwd) {
  const result = runCommand(AGY_BIN, ["models"], { cwd, maxBuffer: MAX_OUTPUT_BYTES });

  if (result.error && result.error.code === "ENOENT") {
    return { authenticated: false, detail: "agy not found", defaultModel: null, models: [] };
  }

  const models = [];
  for (const rawLine of result.stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line || /^(usage|error)\b/i.test(line) || /^fetching\b/i.test(line)) {
      continue;
    }
    const id = line.split("\t")[0].trim();
    if (id && !/\s/.test(id)) {
      models.push(id);
    }
  }

  const authenticated = result.status === 0 && models.length > 0;
  if (!authenticated) {
    const combined = `${result.stderr}\n${result.stdout}`
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !/^fetching\b/i.test(line));
    const detail = combined[0] || `agy models exited with status ${result.status}`;
    return { authenticated: false, detail, defaultModel: null, models };
  }

  // agy does not print which model is its configured default, so only report
  // a default when the AGY_DEFAULT_MODEL override is in effect.
  const defaultModel = resolveModel(null, models);
  return {
    authenticated: true,
    detail: `available (${models.length} models)`,
    defaultModel,
    models
  };
}

/**
 * Pick the model to pass to agy. An explicit --model always wins and is left
 * for agy to validate. The AGY_DEFAULT_MODEL fallback is only used while
 * `agy models` still lists it, so a stale override degrades to agy's own
 * default instead of failing every run.
 */
export function resolveModel(requested, availableModels = []) {
  if (requested) {
    return requested;
  }
  if (!DEFAULT_MODEL) {
    return null;
  }
  if (availableModels.length > 0 && !availableModels.includes(DEFAULT_MODEL)) {
    return null;
  }
  return DEFAULT_MODEL;
}

// Effort levels differ by model and CLI release, so pass the value through and
// let agy reject unsupported ones with its own error message.
function normalizeEffort(effort) {
  if (!effort) {
    return null;
  }
  const value = String(effort).trim().toLowerCase();
  return value || null;
}

function writePromptFile(prompt) {
  const dir = createTempDir("agy-companion-");
  const file = path.join(dir, "prompt.md");
  fs.writeFileSync(file, prompt, "utf8");
  return { dir, file };
}

function cleanupPromptFile(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function buildCommonArgs(cwd, { model = null, effort = null, write = false, resume = false } = {}) {
  const args = ["--add-dir", cwd, "--print-timeout", PRINT_TIMEOUT];

  if (model) {
    args.push("--model", model);
  }
  const normalizedEffort = normalizeEffort(effort);
  if (normalizedEffort) {
    args.push("--effort", normalizedEffort);
  }
  if (resume) {
    args.push("--continue");
  }

  args.push(...(write ? WRITE_CAPABLE_ARGS : READ_ONLY_ARGS));
  return args;
}

function buildPrintPrompt(promptFile) {
  return [
    "Read and follow the complete instructions in this file:",
    `@${promptFile}`,
    "",
    "Use that file as the task source of truth. Return only the final answer requested there."
  ].join("\n");
}

function parseAgyPrintOutput(raw, fallback = {}) {
  const rawOutput = typeof raw === "string" ? raw.trim() : "";

  if (!rawOutput) {
    return {
      text: "",
      rawOutput: "",
      envelope: null,
      parseError: fallback.failureMessage ?? "Antigravity did not return any output."
    };
  }

  try {
    const parsed = JSON.parse(rawOutput);
    // Failures still print an envelope, with status "ERROR" and an `error` field.
    if (parsed && typeof parsed.status === "string" && parsed.status !== "SUCCESS") {
      return {
        text: "",
        rawOutput,
        envelope: parsed,
        parseError:
          (typeof parsed.error === "string" && parsed.error.trim()) ||
          `Antigravity finished with status ${parsed.status}.`
      };
    }
    const text =
      parsed.response ??
      parsed.result ??
      parsed.text ??
      parsed.output_text ??
      parsed.output ??
      parsed.message?.content ??
      "";

    const finalText = typeof text === "string" ? text.trim() : rawOutput;
    let parseError = null;
    if (!finalText && !parsed.structured_output) {
      // The turn can end without an answer, e.g. after the sandbox denied a
      // command the model tried to run. Surface that instead of the envelope.
      const denied = Array.isArray(parsed.denied_actions)
        ? parsed.denied_actions.map((action) => action?.display_name || action?.action).filter(Boolean)
        : [];
      parseError = denied.length > 0
        ? `Antigravity returned an empty response (denied actions: ${denied.join(", ")}).`
        : (fallback.failureMessage ?? "Antigravity returned an empty response.");
    }

    return {
      text: finalText,
      rawOutput,
      envelope: parsed,
      parseError
    };
  } catch {
    return {
      text: rawOutput,
      rawOutput,
      envelope: null,
      parseError: null
    };
  }
}

function runAgyPrint(cwd, prompt, { model = null, effort = null, write = false, resume = false, schema = null } = {}) {
  const { dir, file } = writePromptFile(prompt);
  try {
    const args = [...buildCommonArgs(cwd, { model, effort, write, resume })];
    if (schema) {
      args.push("--json-schema", JSON.stringify(schema));
    }
    args.push("--output-format", "json", "--print", buildPrintPrompt(file));
    const result = runCommand(AGY_BIN, args, { cwd, maxBuffer: MAX_OUTPUT_BYTES });
    const output = parseAgyPrintOutput(result.stdout, {
      failureMessage: "Antigravity did not return any output."
    });

    return {
      status: result.status,
      stderr: result.stderr,
      error: result.error,
      output
    };
  } finally {
    cleanupPromptFile(dir);
  }
}

export function parseReviewJson(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return { parsed: null, parseError: "Antigravity returned an empty review.", rawOutput: "" };
  }

  const candidates = [trimmed];

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    candidates.push(fenceMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return { parsed: JSON.parse(candidate), parseError: null, rawOutput: trimmed };
    } catch {
      // try next candidate
    }
  }

  return { parsed: null, parseError: "Antigravity did not return valid review JSON.", rawOutput: trimmed };
}

export function runReview(cwd, { prompt, schema, model = null, effort = null } = {}) {
  const result = runAgyPrint(cwd, prompt, { model, effort, write: false, resume: false, schema });
  const { output } = result;

  // With --json-schema agy returns the validated object as `structured_output`;
  // prefer it over re-parsing the response text.
  const structured = output.envelope?.structured_output;
  const review =
    structured && typeof structured === "object"
      ? { parsed: structured, parseError: null, rawOutput: output.text || output.rawOutput }
      : output.parseError
        ? { parsed: null, parseError: output.parseError, rawOutput: output.rawOutput }
        : parseReviewJson(output.text || output.rawOutput);

  return { ...result, review };
}

export function runTask(cwd, { prompt, model = null, effort = null, write = true, resume = false } = {}) {
  return runAgyPrint(cwd, prompt, { model, effort, write, resume });
}
