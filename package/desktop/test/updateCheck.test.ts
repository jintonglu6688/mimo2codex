import { describe, it, expect, vi } from "vitest";

// updateCheck.ts imports from "electron" (net) at top level. Mock it so the
// version-parsing helpers we actually exercise here don't trip over the
// electron import in node-test context.
vi.mock("electron", () => ({
  net: { request: () => { throw new Error("not used in this test"); } },
}));

const { parseDesktopVersion, isMinorAhead } = await import("../src/updateCheck.js");

describe("parseDesktopVersion", () => {
  it("parses canonical tags", () => {
    expect(parseDesktopVersion("v0.4.5-desktop")).toEqual([0, 4, 5]);
    expect(parseDesktopVersion("v1.2.3-desktop.4")).toEqual([1, 2, 3]);
    expect(parseDesktopVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseDesktopVersion("garbage")).toBeNull();
  });
});

describe("isMinorAhead", () => {
  it("flags minor-or-major increases only", () => {
    expect(isMinorAhead([0, 4, 5], [0, 5, 0])).toBe(true);
    expect(isMinorAhead([0, 4, 5], [1, 0, 0])).toBe(true);
    expect(isMinorAhead([0, 4, 5], [0, 4, 6])).toBe(false);
    expect(isMinorAhead([0, 5, 0], [0, 4, 9])).toBe(false);
  });
});
