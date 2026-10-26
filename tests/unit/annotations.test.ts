import type * as actionsCore from "@actions/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const { errorMock, warningMock } = vi.hoisted(() => ({
  errorMock: vi.fn(),
  warningMock: vi.fn(),
}));

vi.mock("@actions/core", async (importOriginal) => {
  const actual = await importOriginal<typeof actionsCore>();
  return { ...actual, error: errorMock, warning: warningMock };
});

import type { AnnotationProperties } from "@actions/core";
import { emitAnnotations, emitExecutionFailureAnnotation } from "../../src/annotations";
import { report, result } from "./helpers";

afterEach(() => {
  errorMock.mockReset();
  warningMock.mockReset();
});

describe("emitAnnotations", () => {
  it("emits an error annotation for a fail result with compatibility failure label", () => {
    emitAnnotations(report([result({ status: "fail", testId: "p28-xdr-1", summary: "decode failed" })]));
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]?.[0]).toContain("p28-xdr-1");
    expect(errorMock.mock.calls[0]?.[0]).toContain("[compatibility failure]");
    expect(errorMock.mock.calls[0]?.[1]).toMatchObject({ title: "Stellar Protocol Canary" });
  });

  it("emits an error annotation for an error result with execution error label", () => {
    emitAnnotations(report([result({ status: "error", testId: "p28-rpc-1" })]));
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]?.[0]).toContain("[execution error]");
  });

  it("emits a warning annotation for a warning result with warning label", () => {
    emitAnnotations(report([result({ status: "warning", testId: "p28-rpc-2" })]));
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock.mock.calls[0]?.[0]).toContain("[warning]");
  });

  it("never annotates a pass or skipped result", () => {
    emitAnnotations(report([result({ status: "pass" }), result({ status: "skipped" })]));
    expect(errorMock).not.toHaveBeenCalled();
    expect(warningMock).not.toHaveBeenCalled();
  });

  it("never sets a file/line location, since fixtures do not carry one", () => {
    emitAnnotations(report([result({ status: "fail" })]));
    const properties = errorMock.mock.calls[0]?.[1] as AnnotationProperties | undefined;
    expect(properties?.file).toBeUndefined();
    expect(properties?.startLine).toBeUndefined();
  });

  it("passes a multi-line fail summary through unchanged to core.error", () => {
    // @actions/core is responsible for percent-encoding newlines in the
    // workflow command; emitAnnotations must hand it the raw message.
    const summary = "surface mismatch\n  expected: protocol 28\n  actual: protocol 27";
    emitAnnotations(report([result({ status: "fail", testId: "p28-xdr-2", summary })]));
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]?.[0]).toBe(`[xdr] p28-xdr-2: [compatibility failure] ${summary}`);
    expect(errorMock.mock.calls[0]?.[0]?.split("\n")).toHaveLength(3);
  });

  it("passes a multi-line warning summary through unchanged to core.warning", () => {
    const summary = "deprecated endpoint\n  use the v2 RPC URL";
    emitAnnotations(report([result({ status: "warning", testId: "p28-rpc-3", summary })]));
    expect(warningMock).toHaveBeenCalledTimes(1);
    expect(warningMock.mock.calls[0]?.[0]).toBe(`[xdr] p28-rpc-3: [warning] ${summary}`);
    expect(errorMock).not.toHaveBeenCalled();
  });
});

describe("emitExecutionFailureAnnotation", () => {
  it("emits a single general error annotation", () => {
    emitExecutionFailureAnnotation("cargo install failed");
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock.mock.calls[0]?.[0]).toContain("cargo install failed");
  });
});


describe("fixture lock annotations (#453)", () => {
  it("emits a warning annotation for each lock warning", () => {
    emitAnnotations(report({
      lock: { path: "fixtures/canary.lock", status: "verified", warnings: ["version mismatch", "::warning::unsafe"] },
    }));
    expect(warningMock).toHaveBeenCalledTimes(2);
    expect(warningMock.mock.calls[0]?.[0]).toContain("Fixture lock: version mismatch");
    expect(warningMock.mock.calls[1]?.[0]).toContain("::warning::unsafe");
  });
  it("does not annotate a lock with no warnings", () => {
    emitAnnotations(report({ lock: { path: "fixtures/canary.lock", status: "absent", warnings: [] } }));
    expect(warningMock).not.toHaveBeenCalled();
  });
});
