import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ORDER_AGEING_STEPS } from "./orderMonitoring";

/** The step list lives in the constants and in the migration's CHECK and seed; this keeps them equal. */
describe("order ageing steps", () => {
  it("match the steps the migration allows and seeds", () => {
    // The latest migration to touch the CHECK (#590 added section_3_approval) and the seeds of both.
    const original = readFileSync("supabase/migrations/20261017210000_order_ageing_rules.sql", "utf8");
    const latest = readFileSync("supabase/migrations/20261221150000_1156_order_ageing_status_steps.sql", "utf8");
    const sql = latest;
    const keys = ORDER_AGEING_STEPS.map((step) => step.key);
    const quoted = (text) => [...text.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);

    const check = latest.match(/check\s*\(\s*step\s+in\s*\(([^)]*)\)/i);
    expect(check, "the migration has a CHECK on step").not.toBeNull();
    expect(quoted(check[1]).sort()).toEqual([...keys].sort());

    // The rules that carry over keep their days: renamed in place, never re-seeded blank.
    const seed = sql.match(/insert into[^;]*order_ageing_rules[^;]*;/i);
    expect(seed, "the migration seeds every new step").not.toBeNull();
    const seeded = quoted(seed[0]).filter((key) => keys.includes(key));
    expect(seeded.sort()).toEqual([...keys].sort());
  });

  it("carries the three existing rules over and drops the four that have no step", () => {
    const sql = readFileSync("supabase/migrations/20261221150000_1156_order_ageing_status_steps.sql", "utf8");
    expect(sql).toMatch(/set step = 'ordered' where step = 'purchase_order'/);
    expect(sql).toMatch(/set step = 'customs' where step = 'import_clearance'/);
    const dropped = sql.match(/delete from public\.order_ageing_rules where step in \(([^)]*)\)/);
    expect(dropped, "the four rules are deleted").not.toBeNull();
    expect([...dropped[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()).toEqual(
      ["actual_checking", "create_bill", "received_in_odoo", "with_pop"],
    );
    // The rename runs after the drop of the old constraint and before the new one is added.
    expect(sql.indexOf("drop constraint")).toBeLessThan(sql.indexOf("set step = 'ordered'"));
    expect(sql.indexOf("set step = 'customs'")).toBeLessThan(sql.indexOf("add constraint"));
  });
});
