import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { findFreePort } from "../src/portProbe.js";

describe("findFreePort", () => {
  it("returns the desired port when it's free", async () => {
    // Pick a high port unlikely to be in use; if it IS in use the test is
    // self-correcting (we just get the next free one and assert >= start)
    const port = await findFreePort(45111);
    expect(port).toBeGreaterThanOrEqual(45111);
  });

  it("advances past an occupied port", async () => {
    const occupied = 45222;
    // Bind to 127.0.0.1 specifically — findFreePort probes that interface,
    // and on Windows a server on the unspecified address doesn't collide
    // with a 127.0.0.1 bind. Match interfaces so the test actually exercises
    // the "port taken" branch.
    const server = createServer().listen(occupied, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    try {
      const port = await findFreePort(occupied);
      expect(port).toBeGreaterThan(occupied);
    } finally {
      server.close();
    }
  });

  it("throws if 100 consecutive ports are taken (safety stop)", async () => {
    // We can't realistically occupy 100 ports in a test; instead pass a
    // sentinel start that signals to the impl to use a small max. Approach:
    // override the max via a second argument.
    await expect(findFreePort(45333, 0)).rejects.toThrow(/no free port/i);
  });
});
