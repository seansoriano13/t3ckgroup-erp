import { describe, it, expect } from "vitest";
import { NOTIFICATION_TARGETS } from "./notificationTargets";
import { getNotificationMeta, typeInTab, MODULE_TABS } from "./notificationMeta";

describe("notificationMeta", () => {
  it("reads module and icon from the map", () => {
    expect(getNotificationMeta("SOR_AWARDED")).toEqual({ module: "sors", icon: "Trophy" });
  });
  it("falls back to other/Bell for unknown types and keeps COMMITTEE_* looking like GROUP_*", () => {
    expect(getNotificationMeta("NOPE")).toEqual({ module: "other", icon: "Bell" });
    expect(getNotificationMeta("COMMITTEE_ASSIGNED").module).toBe("tasks");
  });
  it("puts each mapped type in exactly one tab, except other", () => {
    for (const [type, e] of Object.entries(NOTIFICATION_TARGETS)) {
      const n = MODULE_TABS.filter((t) => typeInTab(type, t.value)).length;
      expect(n).toBe(e.module === "other" ? 0 : 1);
    }
  });
});
