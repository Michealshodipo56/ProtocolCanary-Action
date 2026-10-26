import { describe, expect, it } from "vitest";

import { InvalidReportError } from "../../src/errors";
import { describeExitCode, parseReport } from "../../src/output";
import { report, result } from "./helpers";

const VALID_REPORT = JSON.stringify(
  report({
    status: "pass",
    counts: { total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, skipped: 0 },
    results: [
      result({
        testId: "p28-xdr-cap83-empty-tx-set",
        surface: "xdr",
        summary: "StellarValue round-tripped byte-for-byte",
        fixtureId: "p28-xdr-cap83-empty-tx-set",
      }),
    ],
    git: { commit: "68a5f8d", branch: "main", isDirty: false },
  }),
);

describe("parseReport", () => {
  it("parses a well-formed report", () => {
    const report = parseReport(VALID_REPORT);
    expect(report.status).toBe("pass");
    expect(report.counts.total).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(() => parseReport(`\n  ${VALID_REPORT}  \n`)).not.toThrow();
  });

  it("rejects empty output", () => {
    expect(() => parseReport("")).toThrow(InvalidReportError);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseReport("{ not json")).toThrow(InvalidReportError);
  });

  it("rejects JSON that is not an object", () => {
    expect(() => parseReport("[1, 2, 3]")).toThrow(InvalidReportError);
  });

  // #270: an array passes `typeof parsed === "object"`, so the existing
  // array test above is rejected by the later schemaVersion check, not by
  // the non-object guard itself. These pin that guard directly: JSON null,
  // numbers, strings, and booleans are all non-objects the Action must
  // reject with the same "not a report object" message before any field
  // access is attempted on the parsed value.
  it("rejects JSON null as not a report object (#270)", () => {
    expect(() => parseReport("null")).toThrow(InvalidReportError);
    expect(() => parseReport("null")).toThrow(/not a report object/);
  });

  it("rejects a JSON number as not a report object (#270)", () => {
    expect(() => parseReport("42")).toThrow(InvalidReportError);
    expect(() => parseReport("42")).toThrow(/not a report object/);
  });

  it("rejects a JSON string as not a report object (#270)", () => {
    expect(() => parseReport('"a report"')).toThrow(InvalidReportError);
    expect(() => parseReport('"a report"')).toThrow(/not a report object/);
  });

  it("rejects a JSON boolean as not a report object (#270)", () => {
    expect(() => parseReport("true")).toThrow(InvalidReportError);
    expect(() => parseReport("true")).toThrow(/not a report object/);
  });

  it("rejects a report missing schemaVersion", () => {
    const { schemaVersion: _schemaVersion, ...rest } = JSON.parse(VALID_REPORT) as Record<string, unknown>;
    expect(() => parseReport(JSON.stringify(rest))).toThrow(InvalidReportError);
  });

  it("rejects an unsupported schemaVersion", () => {
    const report = { ...JSON.parse(VALID_REPORT), schemaVersion: 2 };
    expect(() => parseReport(JSON.stringify(report))).toThrow(InvalidReportError);
  });

  it("rejects a report with an unrecognized status", () => {
    const report = { ...JSON.parse(VALID_REPORT), status: "unknown" };
    expect(() => parseReport(JSON.stringify(report))).toThrow(InvalidReportError);
  });

  // Regression test: Protocol-Canary's actual tagged v0.1.0 release predates
  // the `counts` field (added in a later, unreleased commit) even though
  // both reports declare schemaVersion 1 — confirmed directly against a
  // real build of the v0.1.0 tag during three-repository E2E validation.
  // `counts` is documented as "purely a convenience — always re-derivable
  // from results[].status", so a report missing it must still parse, not
  // be rejected as malformed.
  it("derives counts from results when the CLI report omits it (older schemaVersion-1 releases)", () => {
    const { counts: _counts, ...withoutCounts } = JSON.parse(VALID_REPORT) as Record<string, unknown>;
    const report = parseReport(JSON.stringify(withoutCounts));
    expect(report.counts).toEqual({ total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, skipped: 0 });
  });

  it("derives counts correctly across every result status and skipped fixtures", () => {
    const report = {
      ...JSON.parse(VALID_REPORT),
      status: "fail",
      results: [
        result({ testId: "a", surface: "xdr", summary: "ok", fixtureId: "a" }),
        result({ testId: "b", surface: "xdr", status: "fail", summary: "bad", fixtureId: "b" }),
        result({ testId: "c", surface: "rpc", status: "warning", summary: "warn", fixtureId: "c" }),
        result({ testId: "d", surface: "rpc", status: "error", summary: "err", fixtureId: "d" }),
      ],
      skipped: [{ fixtureId: "e", surface: "soroban", reason: "disabled" }],
    };
    delete report.counts;
    const parsed = parseReport(JSON.stringify(report));
    expect(parsed.counts).toEqual({ total: 4, passed: 1, failed: 1, warnings: 1, errors: 1, skipped: 1 });
  });

  it("rejects a report whose results field is present but not an array", () => {
    const report = { ...JSON.parse(VALID_REPORT), results: {} };
    expect(() => parseReport(JSON.stringify(report))).toThrow(InvalidReportError);
  });

  it("parses a report with zero results and derives all-zero counts", () => {
    const report = {
      ...JSON.parse(VALID_REPORT),
      results: [],
      counts: { total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0 },
    };
    const parsed = parseReport(JSON.stringify(report));
    expect(parsed.counts).toEqual({ total: 0, passed: 0, failed: 0, warnings: 0, errors: 0, skipped: 0 });
  });

  it("trusts a well-formed counts field from the CLI rather than recomputing it", () => {
    // If the CLI's own counts ever legitimately differed from a naive
    // recount (e.g. a future aggregation rule), the Action must not
    // second-guess it.
    const report = { ...JSON.parse(VALID_REPORT), counts: { total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, skipped: 9 } };
    const parsed = parseReport(JSON.stringify(report));
    expect(parsed.counts.skipped).toBe(9);
  });

  it("derives counts when the provided counts field is malformed", () => {
    const report = { ...JSON.parse(VALID_REPORT), counts: { total: "not-a-number" } };
    const parsed = parseReport(JSON.stringify(report));
    expect(parsed.counts).toEqual({ total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, skipped: 0 });
  });

  // Regression tests for issue #67: the top-level report is otherwise
  // valid, but a single malformed `results` entry must be rejected at
  // parse time with InvalidReportError — not surface later as "undefined"
  // in annotations or the summary markdown.
  const RESULT_FIXTURE = JSON.parse(VALID_REPORT) as Record<string, unknown>;

  function reportWithResultEntry(entry: unknown): string {
    return JSON.stringify({ ...RESULT_FIXTURE, results: [entry] });
  }

  it("rejects a report whose results array contains a non-object entry", () => {
    expect(() => parseReport(reportWithResultEntry("not-an-object"))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing testId", () => {
    const { testId: _testId, ...rest } = {
      testId: "p28-xdr-cap83-empty-tx-set",
      protocol: 28,
      surface: "xdr",
      status: "pass",
      summary: "ok",
      durationMs: 1,
      fixtureId: "p28-xdr-cap83-empty-tx-set",
    };
    expect(() => parseReport(reportWithResultEntry(rest))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing surface", () => {
    const entry = { testId: "a", protocol: 28, status: "pass", summary: "ok", durationMs: 1, fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing status", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", summary: "ok", durationMs: 1, fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry with an invalid status value", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", status: "anything", summary: "ok", durationMs: 1, fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry with an invalid surface value", () => {
    const entry = { testId: "a", protocol: 28, surface: "graphql", status: "pass", summary: "ok", durationMs: 1, fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing summary", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", status: "pass", durationMs: 1, fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing durationMs", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", status: "pass", summary: "ok", fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry with a non-numeric durationMs", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", status: "pass", summary: "ok", durationMs: "100", fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing fixtureId", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", status: "pass", summary: "ok", durationMs: 1 };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("accepts a result entry with a null fixtureId", () => {
    const entry = { testId: "a", protocol: 28, surface: "xdr", status: "pass", summary: "ok", durationMs: 1, fixtureId: null };
    expect(() => parseReport(reportWithResultEntry(entry))).not.toThrow();
  });

  it("rejects a result entry with multiple malformed fields", () => {
    const entry = { testId: 7, surface: "xdr", status: "nope", summary: "ok", durationMs: "100", fixtureId: null };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("rejects a result entry missing the required protocol field", () => {
    const entry = { testId: "a", surface: "xdr", status: "pass", summary: "ok", durationMs: 1, fixtureId: "a" };
    expect(() => parseReport(reportWithResultEntry(entry))).toThrow(InvalidReportError);
  });

  it("identifies the offending result index in the error message", () => {
    const bad = { testId: "a", protocol: 28, surface: "xdr", summary: "ok", durationMs: 1, fixtureId: "a" };
    const good = { testId: "b", protocol: 28, surface: "rpc", status: "pass", summary: "ok", durationMs: 1, fixtureId: "b" };
    const report = { ...RESULT_FIXTURE, results: [good, bad] };
    expect(() => parseReport(JSON.stringify(report))).toThrow(/results\[1\]/);
  });

  it("rejects a skipped entry with a missing required field", () => {
    const report = { ...RESULT_FIXTURE, skipped: [{ fixtureId: "f", surface: "xdr" }] };
    expect(() => parseReport(JSON.stringify(report))).toThrow(InvalidReportError);
  });

  it("rejects a skipped entry with an incorrect field type", () => {
    const report = { ...RESULT_FIXTURE, skipped: [{ fixtureId: "f", surface: "xdr", reason: 42 }] };
    expect(() => parseReport(JSON.stringify(report))).toThrow(InvalidReportError);
  });

  it("accepts a well-formed skipped entry", () => {
    const report = { ...RESULT_FIXTURE, skipped: [{ fixtureId: "f", surface: "xdr", reason: "disabled" }] };
    expect(() => parseReport(JSON.stringify(report))).not.toThrow();
  });

  it("rejects a skipped field that is present but not an array", () => {
    const report = { ...RESULT_FIXTURE, skipped: "none" };
    expect(() => parseReport(JSON.stringify(report))).toThrow(InvalidReportError);
  });
});

describe("describeExitCode", () => {
  it("maps every documented exit code", () => {
    expect(describeExitCode(0).category).toBe("pass");
    expect(describeExitCode(1).category).toBe("compatibility_failure");
    expect(describeExitCode(2).category).toBe("configuration_error");
    expect(describeExitCode(3).category).toBe("execution_error");
    expect(describeExitCode(4).category).toBe("invalid_fixture");
    expect(describeExitCode(5).category).toBe("internal_error");
  });

  it("falls back to unknown for an unrecognized code", () => {
    expect(describeExitCode(99).category).toBe("unknown");
  });

  it("falls back to unknown for a negative code", () => {
    // A negative code can appear when a process-exec library synthesizes one
    // from a fatal signal; pin the Record<number, ...> lookup's fallback so a
    // future EXIT_CODES rework (e.g. a Map or a different default) cannot
    // silently change behavior for out-of-range input.
    expect(describeExitCode(-1).category).toBe("unknown");
  });
});


describe("lock report contract (#453)", () => {
  const base = {
    schemaVersion: 1, toolVersion: "test", targetProtocol: 28,
    project: { name: "example", type: "rust" }, status: "pass",
    results: [], git: { commit: null, branch: null, isDirty: null },
  };
  it("preserves a missing lock without inventing one", () => {
    expect(parseReport(JSON.stringify(base)).lock).toBeUndefined();
  });
  it.each(["absent", "verified"] as const)("accepts %s lock status", (status) => {
    const lock = { path: "fixtures/canary.lock", status, warnings: ["engine version differs"] };
    expect(parseReport(JSON.stringify({ ...base, lock })).lock).toEqual(lock);
  });
  it.each([
    [{ lock: "bad" }, '"lock"'],
    [{ lock: { path: 1, status: "verified", warnings: [] } }, '"lock.path"'],
    [{ lock: { path: "file", status: "unknown", warnings: [] } }, '"lock.status"'],
    [{ lock: { path: "file", status: "verified", warnings: "bad" } }, '"lock.warnings"'],
    [{ lock: { path: "file", status: "verified", warnings: [12] } }, '"lock.warnings"'],
  ])("rejects malformed lock with field-specific error", (patch, field) => {
    expect(() => parseReport(JSON.stringify({ ...base, ...patch }))).toThrow(field);
  });
});
