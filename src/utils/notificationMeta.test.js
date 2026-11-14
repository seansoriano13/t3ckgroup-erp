import { describe, it, expect } from "vitest";
import { NOTIFICATION_TARGETS } from "./notificationTargets";
import { getNotificationMeta, typeInTab, tabsFor, MODULE_TABS } from "./notificationMeta";

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
  it("gives an old type from a replaced feature a History icon, not the Bell", () => {
    for (const [type, e] of Object.entries(NOTIFICATION_TARGETS)) {
      if (e.target === "legacy") expect(e.icon, type).toBe("History");
    }
  });

  describe("tabsFor", () => {
    const values = (ctx) => tabsFor(ctx).map((t) => t.value);

    it("shows a person with no flows only All, Unread and HR", () => {
      expect(values({})).toEqual(["ALL", "UNREAD", "HR"]);
    });
    it("adds a module tab only for the flow that can bring notifications of it", () => {
      expect(values({ hasTaskFlow: true })).toEqual(["ALL", "UNREAD", "TASKS", "HR"]);
      expect(values({ hasSalesFlow: true })).toEqual(["ALL", "UNREAD", "SORS", "PURCHASING", "HR"]);
      expect(values({ hasPurchasingFlow: true })).toEqual(["ALL", "UNREAD", "PURCHASING", "HR"]);
    });
    it("shows HR and Super Admin every tab", () => {
      const every = ["ALL", "UNREAD", ...MODULE_TABS.map((t) => t.value)];
      expect(values({ isHr: true })).toEqual(every);
      expect(values({ isSuperAdmin: true })).toEqual(every);
    });
  });
});
