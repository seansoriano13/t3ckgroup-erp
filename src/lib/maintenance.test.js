import { describe, it, expect } from "vitest"
import { isMaintenanceBlocked } from "./maintenance"

describe("isMaintenanceBlocked", () => {
  it("never blocks when flag unset or off", () => {
    expect(isMaintenanceBlocked({}, "a@x.com")).toBe(false)
    expect(isMaintenanceBlocked({ VITE_MAINTENANCE: "off" }, "a@x.com")).toBe(false)
  })
  it("blocks non-allowlisted user when on", () => {
    const env = { VITE_MAINTENANCE: "on", VITE_MAINTENANCE_ALLOW: "t@x.com" }
    expect(isMaintenanceBlocked(env, "a@x.com")).toBe(true)
  })
  it("lets allowlisted through, case/space-insensitive", () => {
    const env = { VITE_MAINTENANCE: "on", VITE_MAINTENANCE_ALLOW: " T@x.com , b@x.com" }
    expect(isMaintenanceBlocked(env, "t@X.com")).toBe(false)
    expect(isMaintenanceBlocked(env, "b@x.com")).toBe(false)
  })
  it("blocks when on with empty allowlist", () => {
    expect(isMaintenanceBlocked({ VITE_MAINTENANCE: "on" }, "a@x.com")).toBe(true)
  })
})
