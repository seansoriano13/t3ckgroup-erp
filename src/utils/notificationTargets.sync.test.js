import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { MODULES, NOTIFICATION_TARGETS, PENDING, LEGACY } from "./notificationTargets";
import { PUSH_NOTIFICATION_TYPES } from "../constants/pushNotificationTypes";

/**
 * Every notification type the app can write needs an entry in NOTIFICATION_TARGETS,
 * or its click silently does nothing (spec #1013, A11). The list of written types
 * is read out of scripts/notification-click-audit.mjs, which plants one row of each.
 */
const auditSource = readFileSync(path.resolve(process.cwd(), "scripts/notification-click-audit.mjs"), "utf8");
const typesBlock = auditSource.match(/const TYPES = \{([\s\S]*?)\n\};/);
const auditTypes = new Set([...typesBlock[1].matchAll(/"([A-Z][A-Z_]+)"/g)].map((m) => m[1]));

describe("NOTIFICATION_TARGETS", () => {
  it("found the type list in the audit script", () => {
    expect(auditTypes.size).toBeGreaterThan(60);
  });

  it("has an entry for every type the app writes", () => {
    const missing = [...auditTypes, ...PUSH_NOTIFICATION_TYPES].filter((t) => !NOTIFICATION_TARGETS[t]);
    expect(missing).toEqual([]);
  });

  it("has no entry for a type nothing writes", () => {
    const stale = Object.keys(NOTIFICATION_TARGETS).filter((t) => !auditTypes.has(t));
    expect(stale).toEqual([]);
  });

  it("gives every entry a module, an icon and a target", () => {
    for (const [type, entry] of Object.entries(NOTIFICATION_TARGETS)) {
      expect(MODULES, type).toContain(entry.module);
      expect(entry.icon, type).toEqual(expect.any(String));
      expect(typeof entry.target === "function" || entry.target === PENDING || entry.target === LEGACY, type).toBe(true);
    }
  });
});
