import { describe, expect, it } from "vitest";

import { renderExecutionFailureMarkdown, renderSummaryMarkdown } from "../../src/summary";
import { report, result } from "./helpers";

describe("renderSummaryMarkdown", () => {
  it("renders a passing report", () => {
    const markdown = renderSummaryMarkdown(
      report({
        status: "pass",
        counts: { total: 3, passed: 3, failed: 0, warnings: 0, errors: 0, skipped: 0 },
        results: [
          result({ testId: "a", surface: "xdr", fixtureId: "a" }),
          result({ testId: "b", surface: "rpc", fixtureId: "b" }),
          result({ testId: "c", surface: "soroban", fixtureId: "c" }),
        ],
      }),
    );

    expect(markdown).toContain("## Stellar Protocol Canary");
    expect(markdown).toContain("Protocol: 28");
    expect(markdown).toContain("✅ **PASS**");
    expect(markdown).toContain("3/3 applicable checks passed.");
    expect(markdown).toContain("| XDR | ✅ PASS (1/1) |");
    expect(markdown).not.toContain("#### Failures");
  });

  it("renders a failing report with the failing test id and details", () => {
    const markdown = renderSummaryMarkdown(
      report({
        status: "fail",
        counts: { total: 1, passed: 0, failed: 1, warnings: 0, errors: 0, skipped: 0 },
        results: [
          result({
            testId: "p28-xdr-cap83-001",
            surface: "xdr",
            status: "fail",
            summary: "could not satisfy the compatibility assertion",
            details: "byte 12 differs",
            fixtureId: "p28-xdr-cap83-001",
          }),
        ],
      }),
    );

    expect(markdown).toContain("❌ **NOT READY**");
    expect(markdown).toContain("#### Failures");
    expect(markdown).toContain("p28-xdr-cap83-001");
    expect(markdown).toContain("byte 12 differs");
    expect(markdown).toContain("| XDR | ❌ FAIL (0/1) |");
  });

  it("omits a surface row entirely when no results exist for it (offline run)", () => {
    const markdown = renderSummaryMarkdown(
      report({
        status: "pass",
        counts: { total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, skipped: 0 },
        results: [result({ testId: "a", surface: "xdr", fixtureId: "a" })],
      }),
    );
    expect(markdown).not.toContain("| RPC |");
    expect(markdown).not.toContain("| Soroban |");
  });

  it("omits rows for every surface with no matching results, covering all three surfaces", () => {
    // The mirror permutation of the offline-run case: only soroban has
    // results, so surfaceRowLabel must return undefined for both xdr and
    // rpc, and neither may be rendered as an empty pass.
    const markdown = renderSummaryMarkdown(
      report({
        status: "pass",
        counts: { total: 1, passed: 1, failed: 0, warnings: 0, errors: 0, skipped: 0 },
        results: [result({ testId: "s", surface: "soroban", fixtureId: "s" })],
      }),
    );
    expect(markdown).toContain("| Soroban | ✅ PASS (1/1) |");
    expect(markdown).not.toContain("| XDR |");
    expect(markdown).not.toContain("| RPC |");
  });

  it("keeps the surface table ordered xdr, rpc, soroban when results arrive shuffled", () => {
    // Deliberately unordered: soroban and rpc before xdr, so this cannot
    // pass merely by echoing the order of `report.results`.
    const markdown = renderSummaryMarkdown(
      report({
        status: "pass",
        counts: { total: 3, passed: 3, failed: 0, warnings: 0, errors: 0, skipped: 0 },
        results: [
          result({ testId: "soroban-one", surface: "soroban", fixtureId: "soroban-one" }),
          result({ testId: "rpc-one", surface: "rpc", fixtureId: "rpc-one" }),
          result({ testId: "xdr-one", surface: "xdr", fixtureId: "xdr-one" }),
        ],
      }),
    );

    const surfaceRows = [...markdown.matchAll(/^\| (XDR|RPC|Soroban) \|/gm)].map((match) => match[1]);
    expect(surfaceRows).toEqual(["XDR", "RPC", "Soroban"]);
  });

  it("lists skipped fixtures in a collapsible section when present", () => {
    const markdown = renderSummaryMarkdown(
      report({
        skipped: [{ fixtureId: "p27-xdr-legacy", surface: "xdr", reason: "fixture targets protocol 27, this run targets protocol 28" }],
      }),
    );
    expect(markdown).toContain("<details><summary>Skipped fixtures</summary>");
    expect(markdown).toContain("p27-xdr-legacy");
  });

  it("omits the skipped-fixtures section when skipped is an empty array (#264)", () => {
    const markdown = renderSummaryMarkdown(
      report({
        skipped: [],
      }),
    );
    expect(markdown).not.toContain("<details><summary>Skipped fixtures</summary>");
    expect(markdown).not.toContain("Skipped fixtures");
    expect(markdown).not.toContain("</details>");
  });

  it("renders the network name with the observed protocol suffix when both are present", () => {
    // `network` is populated whenever a network/rpc-url is used (see the
    // example workflows), so this branch is not an edge case: the
    // "— observed protocol N" suffix is the part most likely to regress
    // silently.
    const markdown = renderSummaryMarkdown(
      report({
        network: { name: "testnet", observedProtocol: 28 },
        results: [result({ testId: "a", surface: "rpc", fixtureId: "a" })],
      }),
    );

    expect(markdown).toContain("Network: testnet — observed protocol 28");
  });

  it("renders the network name without the suffix when observedProtocol is absent", () => {
    const markdown = renderSummaryMarkdown(
      report({
        network: { name: "testnet" },
        results: [result({ testId: "a", surface: "rpc", fixtureId: "a" })],
      }),
    );

    expect(markdown).toContain("Network: testnet\n");
    expect(markdown).not.toContain("observed protocol");
  });

  it("omits the network line entirely when the report has no network", () => {
    const markdown = renderSummaryMarkdown(report({}));
    expect(markdown).not.toContain("Network:");
  });

  it("never fabricates a result: an empty results array renders as a trivial pass with no surface rows", () => {
    const markdown = renderSummaryMarkdown(report({ status: "pass" }));
    expect(markdown).not.toContain("| XDR |");
    expect(markdown).not.toContain("| RPC |");
    expect(markdown).not.toContain("| Soroban |");
    expect(markdown).toContain("0/0 applicable checks passed.");
  });

  // notablyList(report, ["fail", "error"]) drives the Failures section and
  // notablyList(report, ["warning"]) the Warnings section; these tests pin
  // the status filter between them. A regression that let any status through
  // would either duplicate an entry into the wrong section or invent a
  // Failures/Warnings heading for a report that has none.
  it("lists every non-passing status under Failures and nothing else (#188)", () => {
    const markdown = renderSummaryMarkdown(
      report([
        result({ testId: "xdr-pass", surface: "xdr", status: "pass", summary: "ok", fixtureId: "xdr-pass" }),
        result({ testId: "rpc-warn", surface: "rpc", status: "warning", summary: "slow reply", fixtureId: "rpc-warn" }),
        result({ testId: "xdr-fail", surface: "xdr", status: "fail", summary: "mismatch", fixtureId: "xdr-fail" }),
        result({ testId: "rpc-error", surface: "rpc", status: "error", summary: "connection refused", fixtureId: "rpc-error" }),
      ]),
    );

    const failures = markdown.slice(markdown.indexOf("#### Failures"), markdown.indexOf("#### Warnings"));
    expect(markdown).toContain("#### Failures");
    expect(failures).toContain("`xdr-fail` (xdr) — mismatch");
    expect(failures).toContain("`rpc-error` (rpc) — connection refused");
    // The filter is exact: passing and warning results stay out of Failures.
    expect(failures).not.toContain("xdr-pass");
    expect(failures).not.toContain("rpc-warn");
  });

  it("lists warnings under Warnings and keeps them out of Failures (#188)", () => {
    const markdown = renderSummaryMarkdown(
      report([
        result({ testId: "xdr-warn", surface: "xdr", status: "warning", summary: "deprecated field", fixtureId: "xdr-warn" }),
        result({ testId: "xdr-fail", surface: "xdr", status: "fail", summary: "mismatch", fixtureId: "xdr-fail" }),
      ]),
    );

    const warnings = markdown.slice(markdown.indexOf("#### Warnings"));
    expect(markdown).toContain("#### Warnings");
    expect(warnings).toContain("`xdr-warn` (xdr) — deprecated field");
    expect(warnings).not.toContain("xdr-fail");
    // Conversely the failure must not leak into Warnings either.
    const failures = markdown.slice(markdown.indexOf("#### Failures"), markdown.indexOf("#### Warnings"));
    expect(failures).toContain("xdr-fail");
    expect(failures).not.toContain("xdr-warn");
  });

  it("omits the Warnings section when no warning-status result exists (#188)", () => {
    const markdown = renderSummaryMarkdown(
      report([
        result({ testId: "a", surface: "xdr", status: "pass", summary: "ok", fixtureId: "a" }),
        result({ testId: "b", surface: "rpc", status: "fail", summary: "mismatch", fixtureId: "b" }),
      ]),
    );

    expect(markdown).toContain("#### Failures");
    expect(markdown).not.toContain("#### Warnings");
  });

  it("omits the Failures section when only pass and warning results exist (#188)", () => {
    const markdown = renderSummaryMarkdown(
      report([
        result({ testId: "a", surface: "xdr", status: "pass", summary: "ok", fixtureId: "a" }),
        result({ testId: "b", surface: "rpc", status: "warning", summary: "slow reply", fixtureId: "b" }),
      ]),
    );

    expect(markdown).toContain("#### Warnings");
    expect(markdown).not.toContain("#### Failures");
  });
});

describe("renderExecutionFailureMarkdown", () => {
  it("clearly distinguishes an execution failure from a compatibility failure", () => {
    const markdown = renderExecutionFailureMarkdown("cargo install failed", "error: could not compile");
    expect(markdown).toContain("could not be executed");
    expect(markdown).not.toContain("NOT READY");
    expect(markdown).toContain("error: could not compile");
  });

  it("shows a placeholder when there is no diagnostic output", () => {
    const markdown = renderExecutionFailureMarkdown("timed out", "");
    expect(markdown).toContain("(no diagnostic output)");
  });

  // The diagnostic is raw text from an external process, so it may itself
  // contain ``` (e.g. a compiler or panic message quoting a code block). A
  // fence is only closed by an equally long backtick run at line start, so
  // the fix makes the fence strictly longer than anything the diagnostic
  // contains and the whole diagnostic still renders as one code block (#269).
  it("keeps a diagnostic containing triple backticks inside the fence (#269)", () => {
    const diagnostic = [
      "error: proc-macro panic:",
      "```rust",
      "let x = 1; // quoted code from the panic message",
      "```",
      "stack backtrace:",
    ].join("\n");
    const markdown = renderExecutionFailureMarkdown("check failed to run", diagnostic);

    // The opening fence must be a longer run than any backtick run inside
    // the diagnostic, so no line of the diagnostic can close or reopen it.
    const opening = /^(`{4,})text$/m.exec(markdown);
    expect(opening).not.toBeNull();
    const fence = opening![1]!;
    const longestDiagnosticRun = Math.max(...[...diagnostic.matchAll(/`+/g)].map((match) => match[0].length));
    expect(fence.length).toBeGreaterThan(longestDiagnosticRun);

    // Exactly one opening fence line and one closing fence line: no line of
    // the diagnostic itself closes the block early. (A fence is closed by an
    // equally long run at line start, so any line whose leading run reaches
    // fence length must be one of the two fence lines.)
    const lines = markdown.split("\n");
    expect(lines.filter((line) => line === `${fence}text`)).toHaveLength(1);
    expect(lines.filter((line) => line === fence)).toHaveLength(1);
    for (const line of lines) {
      const run = /^`+/.exec(line)?.[0] ?? "";
      if (run.length >= fence.length) {
        expect([fence, `${fence}text`]).toContain(line);
      }
    }

    // The verbatim diagnostic content survives inside the single block.
    expect(markdown).toContain("```rust");
    expect(markdown).toContain("// quoted code from the panic message");
    expect(markdown).toContain("stack backtrace:");
  });

  it("keeps a diagnostic made of backtick runs alone inside the fence (#269)", () => {
    // Worst case: every line is a run of backticks long enough to close a
    // fixed-length fence, including runs of the same length as the
    // diagnostic's longest run.
    const diagnostic = ["```", "``````", "``````"].join("\n");
    const markdown = renderExecutionFailureMarkdown("spawn failed", diagnostic);

    const opening = /^(`{4,})text$/m.exec(markdown);
    expect(opening).not.toBeNull();
    const fence = opening![1]!;
    // Six backticks inside; the fence must be strictly longer than that.
    expect(fence.length).toBeGreaterThan(6);

    const lines = markdown.split("\n");
    expect(lines.filter((line) => line === `${fence}text`)).toHaveLength(1);
    expect(lines.filter((line) => line === fence)).toHaveLength(1);
    for (const line of lines) {
      const run = /^`+/.exec(line)?.[0] ?? "";
      if (run.length >= fence.length) {
        expect([fence, `${fence}text`]).toContain(line);
      }
    }
  });
});


describe("fixture lock summary (#453)", () => {
  it("keeps reports without lock unchanged", () => {
    expect(renderSummaryMarkdown(report({}))).not.toContain("Fixture lock");
  });
  it.each([
    ["verified", "verified"],
    ["absent", "absent"],
  ] as const)("renders %s lock status", (status, label) => {
    const markdown = renderSummaryMarkdown(report({
      lock: { path: "fixtures/canary.lock", status, warnings: [] },
    }));
    expect(markdown).toContain("### Fixture lock");
    expect(markdown).toContain(`Status: ${label}`);
  });
  it("escapes Markdown and HTML in warnings", () => {
    const markdown = renderSummaryMarkdown(report({
      lock: { path: "fixtures/canary.lock", status: "verified", warnings: ["**bad** <script> ::warning::"] },
    }));
    expect(markdown).not.toContain("<script>");
    expect(markdown).not.toContain("**bad**");
    expect(markdown).toContain("&lt;script&gt;");
    expect(markdown).toContain("::warning::");
  });
});
