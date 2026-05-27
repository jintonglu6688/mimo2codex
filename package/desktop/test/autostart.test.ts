import { describe, expect, it, vi, beforeEach } from "vitest";
import { setAutostart, getAutostart } from "../src/autostart.js";

const setSpy = vi.fn();
const getSpy = vi.fn();

vi.mock("electron", () => ({
  app: {
    setLoginItemSettings: (opts: unknown) => setSpy(opts),
    getLoginItemSettings: () => getSpy(),
  },
}));

beforeEach(() => {
  setSpy.mockReset();
  getSpy.mockReset();
});

describe("setAutostart", () => {
  it("enables with openAsHidden + --autostart-launched arg", () => {
    setAutostart(true);
    expect(setSpy).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true,
      args: ["--autostart-launched"],
    });
  });
  it("disables cleanly", () => {
    setAutostart(false);
    expect(setSpy).toHaveBeenCalledWith({
      openAtLogin: false,
      openAsHidden: false,
      args: [],
    });
  });
});

describe("getAutostart", () => {
  it("reads openAtLogin from Electron", () => {
    getSpy.mockReturnValue({ openAtLogin: true });
    expect(getAutostart()).toBe(true);
    getSpy.mockReturnValue({ openAtLogin: false });
    expect(getAutostart()).toBe(false);
  });
});
