import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createTempDir } from "./fs.mjs";
import { binaryAvailable, runCommand } from "./process.mjs";

// Antigravity CLI executable. Overridable for testing via AGY_BIN.
export const AGY_BIN = process.env.AGY_BIN || "agy";

// Let agy use its configured default unless the caller or environment overrides it.
export const DEFAULT_MODEL = process.env.AGY_DEFAULT_MODEL || null;

const READ_ONLY_ARGS = ["--sandbox"];
const WRITE_CAPABLE_ARGS = ["--dangerously-skip-permissions"];
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const PRINT_TIMEOUT = process.env.AGY_PRINT_TIMEOUT || "10m0s";

export function getAntigravityAvailability(cwd) {
  return binaryAvailable(AGY_BIN, ["--version"], { cwd });
}

export function getAntigravityAuthStatus(cwd) {
  const result = runCommand(AGY_BIN, ["models"], { cwd, maxBuffer: MAX_OUTPUT_BYTES });

  if (result.error && result.error.code === "ENOENT") {
    return { authenticated: false, detail: "agy not found", defaultModel: null, models: [] };
  }

  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const models = [];
  for (const rawLine of combined.split("\n")) {
    const line = rawLine.trim();
    if (line && !/^usage\b/i.test(line) && !/^error\b/i.test(line)) {
      models.push(line);
    }
  }

  const authenticated = result.status === 0 && models.length > 0;
  if (!authenticated) {
    const detail = combined.split("\n")[0] || `agy models exited with status ${result.status}`;
    return { authenticated: false, detail, defaultModel: null, models };
  }

  return {
    authenticated: true,
    detail: `available (${models.length} models)`,
    defaultModel: DEFAULT_MODEL || models[0] || null,
    models
  };
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

function buildCommonArgs(cwd, { model = null, write = false, resume = false } = {}) {
  const args = ["--add-dir", cwd, "--print-timeout", PRINT_TIMEOUT];

  if (model) {
    args.push("--model", model);
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
    const text =
      parsed.response ??
      parsed.result ??
      parsed.text ??
      parsed.output_text ??
      parsed.output ??
      parsed.message?.content ??
      "";

    return {
      text: typeof text === "string" ? text.trim() : rawOutput,
      rawOutput,
      envelope: parsed,
      parseError: null
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

function runAgyPrint(cwd, prompt, { model = null, write = false, resume = false } = {}) {
  const { dir, file } = writePromptFile(prompt);
  try {
    const args = [
      ...buildCommonArgs(cwd, { model, write, resume }),
      "--output-format",
      "json",
      "--print",
      buildPrintPrompt(file)
    ];
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

export function runReview(cwd, { prompt, schema, model = null } = {}) {
  const schemaBlock = schema
    ? `\n\n<json_schema>\n${JSON.stringify(schema, null, 2)}\n</json_schema>\n`
    : "";
  const reviewPrompt = `${prompt}${schemaBlock}`;
  const result = runAgyPrint(cwd, reviewPrompt, { model, write: false, resume: false });

  return {
    ...result,
    review: parseReviewJson(result.output.text || result.output.rawOutput)
  };
}

export function runTask(cwd, { prompt, model = null, write = true, resume = false } = {}) {
  return runAgyPrint(cwd, prompt, { model, write, resume });
}
