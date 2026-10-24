import { InvalidReportError } from "./errors";

/**
 * The JSON report shape produced by `stellar-canary check --format json`,
 * as documented in `docs/json-report-contract.md` of
 * `StellarCanary/Protocol-Canary` (schemaVersion 1). This Action treats
 * that document, not this file, as the source of truth — see
 * CONTRIBUTING.md for how to update this type when the schema changes.
 */
export const SUPPORTED_SCHEMA_VERSION = 1;

export type Surface = "xdr" | "rpc" | "soroban";
export type ResultStatus = "pass" | "warning" | "fail" | "error" | "skipped";
export type OverallStatus = "pass" | "warning" | "fail" | "error";

export interface CanaryResult {
  readonly testId: string;
  readonly protocol: number;
  readonly surface: Surface;
  readonly status: ResultStatus;
  readonly summary: string;
  readonly details?: string;
  readonly durationMs: number;
  readonly fixtureId: string | null;
}

export interface CanarySkip {
  readonly fixtureId: string;
  readonly surface: string;
  readonly reason: string;
}

export interface CanaryCounts {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly warnings: number;
  readonly errors: number;
  readonly skipped: number;
}

export interface CanaryLock {
  readonly path: string;
  readonly status: "absent" | "verified";
  readonly warnings: readonly string[];
}

export interface CanaryReport {
  readonly schemaVersion: number;
  readonly lock?: CanaryLock;
  readonly toolVersion: string;
  readonly targetProtocol: number;
  readonly project: { readonly name: string; readonly type: string };
  readonly network?: { readonly name: string; readonly observedProtocol?: number };
  readonly status: OverallStatus;
  readonly counts: CanaryCounts;
  readonly results: readonly CanaryResult[];
  readonly skipped?: readonly CanarySkip[];
  readonly git: {
    readonly commit: string | null;
    readonly branch: string | null;
    readonly isDirty: boolean | null;
  };
}

function isCountsShape(value: unknown): value is CanaryCounts {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<CanaryCounts>;
  return (
    typeof candidate.total === "number" &&
    typeof candidate.passed === "number" &&
    typeof candidate.failed === "number" &&
    typeof candidate.warnings === "number" &&
    typeof candidate.errors === "number" &&
    typeof candidate.skipped === "number"
  );
}

const RESULT_STATUSES: readonly ResultStatus[] = ["pass", "warning", "fail", "error", "skipped"];
const SURFACES: readonly Surface[] = ["xdr", "rpc", "soroban"];

/**
 * Validates one `results[]` entry against the documented CanaryResult
 * shape. `details` is the only optional field; `fixtureId` may be null.
 * Returns a human-readable reason when the entry is malformed, so the
 * caller can include the offending result's index in the error.
 */
function resultShapeError(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) {
    return "entry is not an object";
  }
  const result = entry as Partial<CanaryResult>;
  if (typeof result.testId !== "string") {
    return "missing or non-string \"testId\"";
  }
  if (typeof result.protocol !== "number") {
    return "missing or non-numeric \"protocol\"";
  }
  if (typeof result.surface !== "string" || !SURFACES.includes(result.surface)) {
    return `invalid \"surface\" (expected one of ${SURFACES.map((s) => `"${s}"`).join(", ")})`;
  }
  if (typeof result.status !== "string" || !RESULT_STATUSES.includes(result.status)) {
    return `invalid \"status\" (expected one of ${RESULT_STATUSES.map((s) => `"${s}"`).join(", ")})`;
  }
  if (typeof result.summary !== "string") {
    return "missing or non-string \"summary\"";
  }
  if (result.details !== undefined && typeof result.details !== "string") {
    return 'non-string "details"';
  }
  if (typeof result.durationMs !== "number") {
    return 'missing or non-numeric "durationMs"';
  }
  if (typeof result.fixtureId !== "string" && result.fixtureId !== null) {
    return 'non-string, non-null "fixtureId"';
  }
  return undefined;
}

/**
 * Validates one `skipped[]` entry against the documented CanarySkip
 * shape (`surface` is a free-form string there, unlike results).
 */
function skipShapeError(entry: unknown): string | undefined {
  if (typeof entry !== "object" || entry === null) {
    return "entry is not an object";
  }
  const skip = entry as Partial<CanarySkip>;
  if (typeof skip.fixtureId !== "string") {
    return 'missing or non-string "fixtureId"';
  }
  if (typeof skip.surface !== "string") {
    return 'missing or non-string "surface"';
  }
  if (typeof skip.reason !== "string") {
    return 'missing or non-string "reason"';
  }
  return undefined;
}

/**
 * `counts` is documented as "purely a convenience — always re-derivable
 * from results[].status" and, like `git`, was added to the report schema
 * after schemaVersion 1 was first shipped without bumping it (a purely
 * additive field). An older Canary release's report predating that
 * addition is still schemaVersion 1 and still fully valid; reject it here
 * and every check against that release fails as an "execution failure"
 * even when Canary itself reported a real pass. Derive `counts` from
 * `results`/`skipped` instead of requiring the CLI to have sent it.
 */
function deriveCounts(results: readonly CanaryResult[], skipped: readonly CanarySkip[] | undefined): CanaryCounts {
  const counts: { total: number; passed: number; failed: number; warnings: number; errors: number; skipped: number } =
    { total: results.length, passed: 0, failed: 0, warnings: 0, errors: 0, skipped: skipped?.length ?? 0 };
  for (const result of results) {
    if (result.status === "pass") counts.passed += 1;
    else if (result.status === "fail") counts.failed += 1;
    else if (result.status === "warning") counts.warnings += 1;
    else if (result.status === "error") counts.errors += 1;
  }
  return counts;
}

/**
 * Parses Canary's stdout as a report matching the documented schema.
 * Throws {@link InvalidReportError} if the text is not JSON, is not
 * shaped like a report, or declares an unsupported `schemaVersion`.
 */
export function parseReport(stdout: string): CanaryReport {
  const trimmed = stdout.trim();
  if (trimmed === "") {
    throw new InvalidReportError("Canary produced no output to parse as a JSON report.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new InvalidReportError(
      `Canary's output could not be parsed as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new InvalidReportError("Canary's JSON output is not a report object.");
  }

  const report = parsed as Partial<CanaryReport>;
  if (typeof report.schemaVersion !== "number") {
    throw new InvalidReportError("Canary's JSON output is missing a numeric \"schemaVersion\" field.");
  }
  if (report.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new InvalidReportError(
      `Unsupported report schemaVersion ${String(report.schemaVersion)} ` +
        `(this Action supports schemaVersion ${String(SUPPORTED_SCHEMA_VERSION)}). ` +
        `A newer Protocol-Canary release may require a newer ProtocolCanary-Action version.`,
    );
  }
  if (
    typeof report.status !== "string" ||
    !["pass", "warning", "fail", "error"].includes(report.status) ||
    !Array.isArray(report.results)
  ) {
    throw new InvalidReportError("Canary's JSON output does not match the documented report shape.");
  }

  const rawResults: unknown[] = report.results;
  for (const [index, entry] of rawResults.entries()) {
    const problem = resultShapeError(entry);
    if (problem !== undefined) {
      throw new InvalidReportError(
        `Canary's JSON output does not match the documented report shape: results[${String(index)}] ${problem}.`,
      );
    }
  }
  const results = rawResults as CanaryResult[];

  if (report.skipped !== undefined && !Array.isArray(report.skipped)) {
    throw new InvalidReportError(
      'Canary\'s JSON output does not match the documented report shape: "skipped" is present but not an array.',
    );
  }
  const rawSkipped: readonly unknown[] = report.skipped ?? [];
  for (const [index, entry] of rawSkipped.entries()) {
    const problem = skipShapeError(entry);
    if (problem !== undefined) {
      throw new InvalidReportError(
        `Canary's JSON output does not match the documented report shape: skipped[${String(index)}] ${problem}.`,
      );
    }
  }
  const skipped = report.skipped as CanarySkip[] | undefined;
  if (report.lock !== undefined) {
    const lock = report.lock as unknown;
    if (typeof lock !== "object" || lock === null || Array.isArray(lock)) {
      throw new InvalidReportError('Canary report has invalid "lock": expected an object.');
    }
    const value = lock as Record<string, unknown>;
    if (typeof value.path !== "string") {
      throw new InvalidReportError('Canary report has invalid "lock.path": expected a string.');
    }
    if (value.status !== "absent" && value.status !== "verified") {
      throw new InvalidReportError('Canary report has invalid "lock.status": expected absent or verified.');
    }
    if (!Array.isArray(value.warnings) || !value.warnings.every((warning: unknown) => typeof warning === "string")) {
      throw new InvalidReportError('Canary report has invalid "lock.warnings": expected an array of strings.');
    }
  }
  const counts = isCountsShape(report.counts) ? report.counts : deriveCounts(results, skipped);

  return { ...report, results, skipped, counts } as CanaryReport;
}

export type ExitCodeCategory =
  | "pass"
  | "compatibility_failure"
  | "configuration_error"
  | "execution_error"
  | "invalid_fixture"
  | "internal_error"
  | "unknown";

interface ExitCodeInfo {
  readonly category: ExitCodeCategory;
  readonly description: string;
}

/**
 * The documented `stellar-canary` exit-code contract
 * (`crates/canary-core/src/errors.rs`). This table is the Action's only
 * understanding of what an exit code *means* — it never reinterprets
 * Canary's actual pass/fail decision.
 */
const EXIT_CODES: Readonly<Record<number, ExitCodeInfo>> = {
  0: { category: "pass", description: "Compatibility checks passed." },
  1: { category: "compatibility_failure", description: "A compatibility check failed." },
  2: { category: "configuration_error", description: "Canary configuration is invalid." },
  3: { category: "execution_error", description: "Execution or RPC communication failed." },
  4: { category: "invalid_fixture", description: "One or more fixtures are invalid." },
  5: { category: "internal_error", description: "Canary encountered an internal error." },
};

/**
 * Describes a `stellar-canary` exit code according to the
 * `crates/canary-core/src/errors.rs` contract. Unrecognized codes fall back
 * to the `unknown` category.
 */
export function describeExitCode(code: number): ExitCodeInfo {
  return EXIT_CODES[code] ?? { category: "unknown", description: `Unrecognized exit code ${String(code)}.` };
}
