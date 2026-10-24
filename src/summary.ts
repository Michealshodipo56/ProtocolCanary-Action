import * as core from "@actions/core";

import { SummaryPublishFailedError } from "./errors";
import type { CanaryReport, OverallStatus, Surface } from "./output";

const SURFACE_HEADINGS: Readonly<Record<Surface, string>> = {
  xdr: "XDR",
  rpc: "RPC",
  soroban: "Soroban",
};

const SURFACE_ORDER: readonly Surface[] = ["xdr", "rpc", "soroban"];

const OVERALL_LABEL: Readonly<Record<OverallStatus, string>> = {
  pass: "✅ **PASS**",
  warning: "⚠️ **WARNING**",
  fail: "❌ **NOT READY**",
  error: "🚫 **ERROR**",
};

/** Aggregates one surface's results into its summary table row. Returns
 * `undefined` when no results match the surface, which is how
 * `renderSummaryMarkdown` omits untouched surfaces (e.g. an offline run has
 * no rpc/soroban rows) instead of fabricating a pass. */
function surfaceRowLabel(results: CanaryReport["results"], surface: Surface): string | undefined {
  const forSurface = results.filter((r) => r.surface === surface);
  if (forSurface.length === 0) {
    return undefined;
  }
  const worst = forSurface.some((r) => r.status === "fail" || r.status === "error")
    ? "fail"
    : forSurface.some((r) => r.status === "warning")
      ? "warning"
      : "pass";
  const passCount = forSurface.filter((r) => r.status === "pass").length;
  const icon = worst === "fail" ? "❌ FAIL" : worst === "warning" ? "⚠️ WARNING" : "✅ PASS";
  return `| ${SURFACE_HEADINGS[surface]} | ${icon} (${String(passCount)}/${String(forSurface.length)}) |`;
}

function notablyList(report: CanaryReport, statuses: readonly ("fail" | "error" | "warning")[]): string[] {
  return report.results
    .filter((r) => (statuses as readonly string[]).includes(r.status))
    .map((r) => {
      const lines = [`- \`${r.testId}\` (${r.surface}) — ${r.summary}`];
      if (r.details !== undefined && r.details.trim() !== "") {
        lines.push(
          r.details
            .trim()
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n"),
        );
      }
      return lines.join("\n");
    });
}

/** Pure Markdown rendering, kept separate from `core.summary` so it can be
 * golden/snapshot-tested without a GitHub Actions runtime. */
export function renderSummaryMarkdown(report: CanaryReport): string {
  const lines: string[] = [];
  lines.push("## Stellar Protocol Canary", "");
  lines.push(`Protocol: ${String(report.targetProtocol)}`);
  lines.push(`Project: ${report.project.name} (${report.project.type})`);
  if (report.network !== undefined) {
    const observed =
      report.network.observedProtocol !== undefined ? ` — observed protocol ${String(report.network.observedProtocol)}` : "";
    lines.push(`Network: ${report.network.name}${observed}`);
  }
  lines.push(`Canary version: ${report.toolVersion}`, "");

  const rows = SURFACE_ORDER.map((surface) => surfaceRowLabel(report.results, surface)).filter(
    (row): row is string => row !== undefined,
  );
  if (rows.length > 0) {
    lines.push("| Surface | Result |", "|---|---|", ...rows, "");
  }

  if (report.lock !== undefined) {
    const safe = (value: string): string => value.slice(0, 8192).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n/g, " ").replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1");
    lines.push("### Fixture lock", "", `Status: ${safe(report.lock.status)}`, "");
    if (report.lock.warnings.length > 0) {
      lines.push(...report.lock.warnings.map((warning) => `- ⚠️ ${safe(warning)}`), "");
    }
  }
  lines.push("### Result", "", OVERALL_LABEL[report.status], "");
  lines.push(`${String(report.counts.passed)}/${String(report.counts.total)} applicable checks passed.`, "");

  const failures = notablyList(report, ["fail", "error"]);
  if (failures.length > 0) {
    lines.push("#### Failures", "", ...failures, "");
  }

  const warnings = notablyList(report, ["warning"]);
  if (warnings.length > 0) {
    lines.push("#### Warnings", "", ...warnings, "");
  }

  if (report.skipped !== undefined && report.skipped.length > 0) {
    lines.push(
      "<details><summary>Skipped fixtures</summary>",
      "",
      ...report.skipped.map((s) => `- \`${s.fixtureId}\` (${s.surface}) — ${s.reason}`),
      "",
      "</details>",
      "",
    );
  }

  return lines.join("\n");
}

/**
 * Longest fenced code block the summary may embed, used to pick a fence
 * length that is strictly longer than any run of backticks the embedded
 * text itself contains. A fence is only closed by an equally long run at
 * line start, so a run inside the content can never close a longer fence.
 */
const MAX_EMBEDDED_FENCE_LENGTH = 20;

/**
 * Markdown rendering of an execution failure — the "Canary could not run
 * at all" case, distinct from a compatibility failure the report describes.
 *
 * The diagnostic is embedded verbatim inside a fenced code block, but it is
 * raw text from an external process (stderr, a timeout notice), so it may
 * itself contain ``` (e.g. a compiler/panic message quoting a code block).
 * A fixed fence would be closed early by that sequence, and the rest of the
 * diagnostic would render as broken markdown. The fence is therefore made
 * longer than the longest backtick run the diagnostic contains — the exact
 * strategy CommonMark §Fenced code blocks specifies for embedding such
 * content.
 */
export function renderExecutionFailureMarkdown(reason: string, diagnostic: string): string {
  const trimmed = diagnostic.trim();
  // Longest run of backticks anywhere in the diagnostic, in characters.
  // Also covers the closing fence the diagnostic text may already contain,
  // because a closing fence of length n is itself a run of n backticks.
  const longestRun = (trimmed.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  // A fence shorter than the diagnostic's longest run could be closed early
  // by that run; one strictly longer cannot. 20 backticks of headroom also
  // gives nested embedding (a summary quoted inside another code block) room.
  const fenceLength = Math.max(3, longestRun + 1, MAX_EMBEDDED_FENCE_LENGTH);
  const fence = "`".repeat(fenceLength);
  return [
    "## Stellar Protocol Canary",
    "",
    "### Result",
    "",
    "🚫 **ERROR**",
    "",
    "Protocol Canary could not be executed.",
    "",
    `Reason: ${reason}`,
    "",
    fence + "text",
    trimmed === "" ? "(no diagnostic output)" : trimmed,
    fence,
  ].join("\n");
}

/**
 * Publishes `markdown` to the current GitHub Actions job summary.
 *
 * This wraps `core.summary.addRaw(markdown, true).write()`. If adding or
 * writing the summary fails, it throws {@link SummaryPublishFailedError}
 * with the underlying error message.
 *
 * @param markdown Markdown to append to the job summary.
 * @throws {SummaryPublishFailedError} When summary publication fails.
 */
export async function writeSummary(markdown: string): Promise<void> {
  try {
    await core.summary.addRaw(markdown, true).write();
  } catch (error) {
    throw new SummaryPublishFailedError(
      `Failed to publish Canary summary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
