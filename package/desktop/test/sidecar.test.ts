import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

// Import AFTER mocks are set up
const { SidecarManager } = await import("../src/sidecar.js");

class FakeChild extends EventEmitter {
  pid = 12345;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = vi.fn((sig?: string) => {
    this.killed = true;
    // Simulate async exit
    setImmediate(() => this.emit("exit", sig === "SIGKILL" ? null : 0, sig ?? null));
    return true;
  });
}

let child: FakeChild;
beforeEach(() => {
  spawnMock.mockReset();
  child = new FakeChild();
  spawnMock.mockReturnValue(child);
});
afterEach(() => {
  vi.clearAllMocks();
});

describe("SidecarManager", () => {
  it("spawns with the configured binary + args", async () => {
    const sm = new SidecarManager({ binPath: "/path/sidecar", dataDir: "/data", port: 8788 });
    await sm.start();
    expect(spawnMock).toHaveBeenCalledWith(
      "/path/sidecar",
      expect.arrayContaining(["--data-dir", "/data", "--port", "8788"]),
      expect.anything()
    );
    expect(sm.status().kind).toBe("running");
  });

  it("transitions to crashed on non-zero exit", async () => {
    const sm = new SidecarManager({ binPath: "/p", dataDir: "/d", port: 8788, maxRestarts: 0 });
    await sm.start();
    child.emit("exit", 1, null);
    await new Promise((r) => setImmediate(r));
    expect(sm.status().kind).toBe("crashed");
  });

  it("auto-restarts once on first crash", async () => {
    const sm = new SidecarManager({ binPath: "/p", dataDir: "/d", port: 8788, maxRestarts: 1 });
    await sm.start();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    // The next spawn should return a fresh FakeChild so onExit doesn't loop
    spawnMock.mockReturnValueOnce(new FakeChild());
    child.emit("exit", 1, null);
    await new Promise((r) => setImmediate(r));
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(sm.status().kind).toBe("running");
  });

  it("stops with SIGTERM, escalates to SIGKILL after grace period", async () => {
    vi.useFakeTimers();
    const sm = new SidecarManager({ binPath: "/p", dataDir: "/d", port: 8788, killGraceMs: 100 });
    await sm.start();
    // Override kill to NOT auto-emit exit, so we can drive the grace timer
    child.kill = vi.fn(() => true);
    const stopP = sm.stop();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    // Async variant: advances the fake clock AND drains microtasks so the
    // Promise.race + await continuation can dispatch the second kill().
    await vi.advanceTimersByTimeAsync(101);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    // Simulate exit after SIGKILL
    child.emit("exit", null, "SIGKILL");
    await stopP;
    vi.useRealTimers();
  });
});
