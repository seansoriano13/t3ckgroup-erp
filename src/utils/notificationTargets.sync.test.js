import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { MODULES, NOTIFICATION_TARGETS, LEGACY } from "./notificationTargets";
import { PUSH_NOTIFICATION_TYPES } from "../constants/pushNotificationTypes";

/**
 * Every notification type the app can write needs an entry in NOTIFICATION_TARGETS,
 * or its click silently does nothing (spec #1013, A11). The list of written types
 * is collected from src/services, supabase/migrations and the click audit script.
 */
function walk(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full, ext);
    return e.name.endsWith(ext) && !/\.test\./.test(e.name) ? [full] : [];
  });
}
const root = process.cwd();

// 1. Services: `type: "X"` in the objects handed to the notifications table.
const serviceTypes = walk(path.join(root, "src/services"), ".js").flatMap((f) =>
  [...readFileSync(f, "utf8").matchAll(/type:\s*["']([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)["']/g)].map((m) => m[1]),
);
// 2. Migrations: quoted names inside `insert into notifications ...;` statements.
const migrationTypes = walk(path.join(root, "supabase/migrations"), ".sql").flatMap((f) =>
  [...readFileSync(f, "utf8").matchAll(/insert\s+into\s+(?:public\.)?notifications[^;]*;/gi)].flatMap((m) =>
    [...m[0].matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)].map((t) => t[1]),
  ),
);
// 3. The click audit script, which plants one row of every type.
const auditSource = readFileSync(path.join(root, "scripts/notification-click-audit.mjs"), "utf8");
const typesBlock = auditSource.match(/const TYPES = \{([\s\S]*?)\r?\n\};/);
const auditTypes = [...typesBlock[1].matchAll(/"([A-Z][A-Z_]+)"/g)].map((m) => m[1]);

const writtenTypes = new Set([...serviceTypes, ...migrationTypes, ...auditTypes]);

describe("NOTIFICATION_TARGETS", () => {
  it("found the type list in the audit script", () => {
    expect(writtenTypes.size).toBeGreaterThan(60);
  });

  it("has an entry for every type the app writes", () => {
    const missing = [...writtenTypes, ...PUSH_NOTIFICATION_TYPES].filter((t) => !NOTIFICATION_TARGETS[t]);
    expect(missing).toEqual([]);
  });

  it("gives every entry a module, an icon and a target", () => {
    for (const [type, entry] of Object.entries(NOTIFICATION_TARGETS)) {
      expect(MODULES, type).toContain(entry.module);
      expect(entry.icon, type).toEqual(expect.any(String));
      expect(typeof entry.target === "function" || entry.target === LEGACY, type).toBe(true);
    }
  });
});
