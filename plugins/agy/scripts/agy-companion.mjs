#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { parseArgs, splitRawArgumentString } from "./lib/args.mjs";
import { readStdinIfPiped, readJsonFile } from "./lib/fs.mjs";
import { collectReviewContext, resolveReviewTarget } from "./lib/git.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";
import { binaryAvailable } from "./lib/process.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import {
  getAntigravityAuthStatus,
  getAntigravityAvailability,
  resolveModel,
  runReview,
  runTask
} from "./lib/agy.mjs";
import { renderReviewResult, renderSetupReport, renderTaskResult } from "./lib/render.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const REVIEW_SCHEMA_PATH = path.join(PLUGIN_ROOT, "schemas", "review-output.schema.json");

const ARG_CONFIG = {
  valueOptions: ["cwd", "base", "scope", "model", "effort", "prompt-file", "audio", "context-file", "format-file", "output-file"],
  booleanOptions: ["json", "write", "read-only", "resume-last"],
  aliasMap: { C: "cwd" }
};

function parseCommandInput(rawArgs) {
  const { options, positionals } = parseArgs(rawArgs, ARG_CONFIG);
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  return { options, positionals, cwd };
}

function resolvePrompt(options, positionals) {
  if (options["prompt-file"]) {
    return fs.readFileSync(options["prompt-file"], "utf8").trim();
  }
  const joined = positionals.join(" ").trim();
  if (joined) {
    return joined;
  }
  return readStdinIfPiped().trim();
}

function expandPath(inputPath) {
  if (!inputPath) {
    return inputPath;
  }
  if (inputPath === "~") {
    return process.env.HOME || inputPath;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(process.env.HOME || "~", inputPath.slice(2));
  }
  return inputPath;
}

function resolveFilePath(inputPath, cwd) {
  const expanded = expandPath(inputPath);
  return path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded);
}

function requireExistingFile(label, inputPath, cwd) {
  const resolved = resolveFilePath(inputPath, cwd);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${label} does not exist or is not a file: ${resolved}`);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// setup
// ---------------------------------------------------------------------------

function buildSetupReport(cwd) {
  const node = { detail: process.version };
  const agyAvail = getAntigravityAvailability(cwd);
  const agy = { available: agyAvail.available, detail: agyAvail.detail };

  let auth = { authenticated: false, detail: "agy unavailable", defaultModel: null, models: [] };
  if (agyAvail.available) {
    auth = getAntigravityAuthStatus(cwd);
  }

  const ready = agyAvail.available && auth.authenticated;
  const nextSteps = [];
  if (!agyAvail.available) {
    nextSteps.push("Install the Antigravity CLI, then rerun /agy:setup.");
  } else if (!auth.authenticated) {
    nextSteps.push("Run `agy login` in a terminal, then rerun /agy:setup.");
  }

  return {
    ready,
    node,
    agy,
    auth: { detail: auth.detail },
    defaultModel: auth.defaultModel,
    models: auth.models,
    actionsTaken: [],
    nextSteps
  };
}

function handleSetup(input) {
  const report = buildSetupReport(input.cwd);
  if (input.options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(renderSetupReport(report));
  }
  return 0;
}

// ---------------------------------------------------------------------------
// review
// ---------------------------------------------------------------------------

function buildReviewPrompt(context, focusText) {
  const template = loadPromptTemplate(PLUGIN_ROOT, "review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    USER_FOCUS: focusText || "(none provided — review the change broadly)",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  });
}

function ensureAntigravityReady(cwd) {
  const agyAvail = getAntigravityAvailability(cwd);
  if (!agyAvail.available) {
    throw new Error("Antigravity CLI is not available. Run /agy:setup for guidance.");
  }
  const auth = getAntigravityAuthStatus(cwd);
  if (!auth.authenticated) {
    throw new Error("Antigravity is not authenticated. Run `agy login`, then retry. See /agy:setup.");
  }
  return auth;
}

function handleReview(input, reviewLabel) {
  const workspaceRoot = resolveWorkspaceRoot(input.cwd);
  const auth = ensureAntigravityReady(workspaceRoot);

  const target = resolveReviewTarget(workspaceRoot, {
    base: input.options.base ?? null,
    scope: input.options.scope ?? "auto"
  });

  const context = collectReviewContext(workspaceRoot, target);
  const focusText = input.positionals.join(" ").trim();
  const prompt = buildReviewPrompt(context, focusText);

  const schema = readJsonFile(REVIEW_SCHEMA_PATH);
  const model = resolveModel(input.options.model, auth.models);
  const effort = input.options.effort ?? null;

  const reviewResult = runReview(workspaceRoot, { prompt, schema, model, effort });
  const rendered = renderReviewResult(reviewResult, {
    reviewLabel,
    targetLabel: target.label
  });

  process.stdout.write(rendered);
  return reviewResult.status === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// task (rescue)
// ---------------------------------------------------------------------------

function handleTask(input) {
  const workspaceRoot = resolveWorkspaceRoot(input.cwd);
  const auth = ensureAntigravityReady(workspaceRoot);

  const prompt = resolvePrompt(input.options, input.positionals);
  if (!prompt) {
    process.stderr.write("No task prompt provided.\n");
    return 1;
  }

  // Write-capable by default; --read-only forces analysis-only.
  const write = input.options["read-only"] ? false : true;
  const resume = Boolean(input.options["resume-last"]);
  const model = resolveModel(input.options.model, auth.models);
  const effort = input.options.effort ?? null;

  const taskResult = runTask(workspaceRoot, { prompt, model, effort, write, resume });
  process.stdout.write(renderTaskResult(taskResult));
  return taskResult.status === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// meeting-notes
// ---------------------------------------------------------------------------

function resolveMeetingNotesInput(input) {
  const positionals = [...input.positionals];
  const audioInput = input.options.audio ?? positionals.shift();
  if (!audioInput) {
    throw new Error("No audio file provided. Use --audio <path> or pass the audio path as the first argument.");
  }

  const audioPath = requireExistingFile("Audio file", audioInput, input.cwd);
  const contextFile = input.options["context-file"]
    ? requireExistingFile("Context file", input.options["context-file"], input.cwd)
    : null;
  const formatFile = input.options["format-file"]
    ? requireExistingFile("Format file", input.options["format-file"], input.cwd)
    : null;
  const outputFile = input.options["output-file"]
    ? resolveFilePath(input.options["output-file"], input.cwd)
    : null;
  const inlineContext = positionals.join(" ").trim();

  return { audioPath, contextFile, formatFile, outputFile, inlineContext };
}

function buildMeetingNotesPrompt({ audioPath, contextFile, formatFile, inlineContext }) {
  const defaultFormat = [
    "# 회의록",
    "",
    "## 회의 정보",
    "- 일시:",
    "- 참석자:",
    "- 안건:",
    "",
    "## 핵심 요약",
    "- ",
    "",
    "## 논의 내용",
    "- ",
    "",
    "## 결정 사항",
    "- ",
    "",
    "## 액션 아이템",
    "| 담당자 | 할 일 | 기한 | 상태 |",
    "| --- | --- | --- | --- |",
    "",
    "## 미확인 사항",
    "- "
  ].join("\n");

  const sections = [
    "You are creating meeting minutes from an audio recording.",
    "",
    "Audio input:",
    `@${audioPath}`,
    "",
    "Requirements:",
    "- Listen to the audio directly and extract the meeting content.",
    "- Use the same language as the meeting unless the provided context asks otherwise.",
    "- Use additional context only to disambiguate names, teams, products, dates, and desired terminology.",
    "- Do not fabricate missing details. Mark unclear speakers, dates, owners, and deadlines as 미확인.",
    "- Preserve concrete decisions, owners, deadlines, risks, and follow-up questions.",
    "- Return only the meeting minutes. Do not include process notes."
  ];

  if (contextFile) {
    sections.push("", "Additional context file:", `@${contextFile}`);
  }
  if (inlineContext) {
    sections.push("", "Additional context and requested format text:", inlineContext);
  }
  if (formatFile) {
    sections.push("", "Output format file:", `@${formatFile}`, "", "Follow the output format file exactly.");
  } else {
    sections.push("", "Default output format to use when no custom format is requested:", defaultFormat);
  }

  return sections.join("\n");
}

function handleMeetingNotes(input) {
  const workspaceRoot = resolveWorkspaceRoot(input.cwd);
  const auth = ensureAntigravityReady(workspaceRoot);

  const meetingInput = resolveMeetingNotesInput(input);
  const prompt = buildMeetingNotesPrompt(meetingInput);
  const model = resolveModel(input.options.model, auth.models);
  const effort = input.options.effort ?? null;

  const taskResult = runTask(workspaceRoot, {
    prompt,
    model,
    effort,
    write: false,
    resume: false
  });
  const rendered = renderTaskResult(taskResult);

  if (meetingInput.outputFile && taskResult.status === 0) {
    fs.mkdirSync(path.dirname(meetingInput.outputFile), { recursive: true });
    fs.writeFileSync(meetingInput.outputFile, rendered, "utf8");
  }

  process.stdout.write(rendered);
  return taskResult.status === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

function expandArgs(argv) {
  // Slash commands pass all arguments as a single quoted string. Split it.
  if (argv.length === 1 && /\s/.test(argv[0])) {
    return splitRawArgumentString(argv[0]);
  }
  return argv;
}

function main() {
  const [, , subcommand, ...rest] = process.argv;

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    process.stdout.write("Usage: agy-companion.mjs <setup|review|adversarial-review|task|meeting-notes> [options]\n");
    return 0;
  }

  const rawArgs = expandArgs(rest);
  const input = parseCommandInput(rawArgs);

  switch (subcommand) {
    case "setup":
      return handleSetup(input);
    case "review":
      return handleReview(input, "Review");
    case "adversarial-review":
      return handleReview(input, "Adversarial Review");
    case "task":
      return handleTask(input);
    case "meeting-notes":
      return handleMeetingNotes(input);
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
      return 1;
  }
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
