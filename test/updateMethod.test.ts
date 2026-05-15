import { describe, expect, it } from "vitest";
import { detectUpdateMethod, packageRoot } from "../src/setup/updateMethod.js";

describe("detectUpdateMethod", () => {
  it("returns a non-empty command, regardless of which path is taken", () => {
    const info = detectUpdateMethod();
    expect(info.command.length).toBeGreaterThan(0);
    expect(info.steps.length).toBeGreaterThan(0);
    expect(info.rootDir).toBe(packageRoot());
  });

  it("classifies as 'git' when run inside the repo (this test env)", () => {
    // The test process runs inside the repo checkout, which has .git/.
    // This pins the heuristic so a regression that breaks .git detection
    // (e.g. an off-by-one in the PACKAGE_ROOT resolve) shows up here.
    const info = detectUpdateMethod();
    expect(info.method).toBe("git");
    expect(info.steps[0].argv[0]).toBe("git");
    expect(info.steps[0].argv).toContain("pull");
    expect(info.command).toMatch(/git -C .*pull --ff-only/);
    expect(info.command).toMatch(/npm install --prefix/);
    expect(info.command).toMatch(/build:all/);
  });
});
