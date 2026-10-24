import * as core from "@actions/core";

import type { CanaryReport } from "./output";

const TITLE = "Stellar Protocol Canary";

const STATUS_LABEL: Readonly<Record<string, string>> = {
  fail: "compatibility failure",
  error: "execution error",
  warning: "warning",
};

/**
 * Converts fail/error/warning results into GitHub annotations. No fixture
 * in the documented report schema carries a file/line location, so every
 * annotation is a general workflow-level one (`core.error`/`core.warning`
 * with no `AnnotationProperties.file`) — never a fabricated location.
 * Passing and skipped results never produce an annotation: they are not
 * actionable.
 */
export function emitAnnotations(report: CanaryReport): void {
  for (const result of report.results) {
    const label = STATUS_LABEL[result.status] ?? result.status;
    const message = `[${result.surface}] ${result.testId}: [${label}] ${result.summary}`;
    if (result.status === "fail" || result.status === "error") {
      core.error(message, { title: TITLE });
    } else if (result.status === "warning") {
      core.warning(message, { title: TITLE });
    }
  }
  for (const warning of report.lock?.warnings ?? []) {
    core.warning(`Fixture lock: ${warning.slice(0, 8192)}`, { title: TITLE });
  }
}

/**
 * Emits a workflow-level error annotation when Canary could not be executed
 * or did not produce a usable report. Use this for execution failures
 * (install, process, timeout, or parse errors) instead of `emitAnnotations`,
 * which annotates individual results from a report. Like `emitAnnotations`,
 * this never attaches a file/line location.
 */
export function emitExecutionFailureAnnotation(reason: string): void {
  core.error(`Protocol Canary could not be executed: ${reason}`, { title: TITLE });
}
