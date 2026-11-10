import { describe, it, expect, afterEach, vi } from "vitest";
import { getDevLoginPrefill } from "../../utils/devLoginPrefill.js";

describe("getDevLoginPrefill", () => {
  afterEach(() => vi.unstubAllEnvs());

  function stub(dev, mode) {
    vi.stubEnv("VITE_MAGIC_LOGIN_EMAIL", "a@b.c");
    vi.stubEnv("VITE_MAGIC_LOGIN_PASSWORD", "secret");
    vi.stubEnv("DEV", dev);
    vi.stubEnv("MODE", mode);
  }

  it("prefills in dev", () => {
    stub(true, "development");
    expect(getDevLoginPrefill()).toEqual({ email: "a@b.c", password: "secret" });
  });
  it("is empty outside dev", () => {
    stub(false, "production");
    expect(getDevLoginPrefill()).toEqual({ email: "", password: "" });
  });
  it("is empty in test mode", () => {
    stub(true, "test");
    expect(getDevLoginPrefill()).toEqual({ email: "", password: "" });
  });
});
