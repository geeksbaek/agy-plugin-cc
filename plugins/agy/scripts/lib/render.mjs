const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function severityRank(severity) {
  return SEVERITY_ORDER[severity] ?? 99;
}

function formatLineRange(finding) {
  const start = finding.line_start;
  const end = finding.line_end;
  if (Number.isFinite(start) && Number.isFinite(end)) {
    return start === end ? `:${start}` : `:${start}-${end}`;
  }
  if (Number.isFinite(start)) {
    return `:${start}`;
  }
  return "";
}

function validateReviewShape(data) {
  if (!data || typeof data !== "object") {
    return "review is not an object";
  }
  if (typeof data.verdict !== "string") {
    return "missing verdict";
  }
  if (typeof data.summary !== "string") {
    return "missing summary";
  }
  if (!Array.isArray(data.findings)) {
    return "findings is not an array";
  }
  return null;
}

function normalizeReview(data) {
  return {
    verdict: data.verdict,
    summary: data.summary,
    findings: Array.isArray(data.findings) ? data.findings : [],
    next_steps: Array.isArray(data.next_steps) ? data.next_steps : []
  };
}

export function renderSetupReport(report) {
  const lines = [
    "# Antigravity Setup",
    "",
    `Status: ${report.ready ? "ready" : "needs attention"}`,
    "",
    "Checks:",
    `- node: ${report.node.detail}`,
    `- agy: ${report.agy.detail}`,
    `- auth: ${report.auth.detail}`
  ];

  if (report.defaultModel) {
    lines.push(`- default model: ${report.defaultModel}`);
  }
  if (report.models && report.models.length > 0) {
    lines.push(`- available models: ${report.models.join(", ")}`);
  }
  lines.push("");

  if (report.actionsTaken && report.actionsTaken.length > 0) {
    lines.push("Actions taken:");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  if (report.nextSteps && report.nextSteps.length > 0) {
    lines.push("Next steps:");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderReviewResult(reviewResult, meta) {
  const { review, output, status, stderr } = reviewResult;
  const header = `# Antigravity ${meta.reviewLabel}`;

  // Antigravity invocation itself failed.
  if (reviewResult.error || (status !== 0 && !review.parsed)) {
    const lines = [header, "", `Target: ${meta.targetLabel}`, "", "Antigravity review failed."];
    const detail = reviewResult.error?.message || stderr?.trim() || output?.parseError;
    if (detail) {
      lines.push("", "```text", detail, "```");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  // Parsed but not valid JSON.
  if (!review.parsed) {
    const lines = [
      header,
      "",
      `Target: ${meta.targetLabel}`,
      "",
      "Antigravity did not return valid structured JSON.",
      "",
      `- Parse error: ${review.parseError}`
    ];
    if (review.rawOutput) {
      lines.push("", "Raw response:", "", "```text", review.rawOutput, "```");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const validationError = validateReviewShape(review.parsed);
  if (validationError) {
    const lines = [
      header,
      "",
      `Target: ${meta.targetLabel}`,
      "",
      "Antigravity returned JSON with an unexpected review shape.",
      "",
      `- Validation error: ${validationError}`
    ];
    if (review.rawOutput) {
      lines.push("", "Raw response:", "", "```text", review.rawOutput, "```");
    }
    return `${lines.join("\n").trimEnd()}\n`;
  }

  const data = normalizeReview(review.parsed);
  const findings = [...data.findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
  const lines = [header, "", `Target: ${meta.targetLabel}`, `Verdict: ${data.verdict}`, "", data.summary, ""];

  if (findings.length === 0) {
    lines.push("No material findings.");
  } else {
    lines.push("Findings:");
    for (const finding of findings) {
      const lineSuffix = formatLineRange(finding);
      lines.push(`- [${finding.severity}] ${finding.title} (${finding.file}${lineSuffix})`);
      if (finding.body) {
        lines.push(`  ${finding.body}`);
      }
      if (finding.recommendation) {
        lines.push(`  Recommendation: ${finding.recommendation}`);
      }
    }
  }

  if (data.next_steps.length > 0) {
    lines.push("", "Next steps:");
    for (const step of data.next_steps) {
      lines.push(`- ${step}`);
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult(taskResult) {
  const { output, status, stderr, error } = taskResult;
  const text = output?.text?.trim() || output?.rawOutput?.trim() || "";

  if (text) {
    return `${text}\n`;
  }

  const lines = ["Antigravity did not return a final message."];
  const detail = error?.message || stderr?.trim();
  if (detail) {
    lines.push("", "```text", detail, "```");
  } else if (status !== 0) {
    lines.push(`(agy exited with status ${status})`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
