import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ORDER_AGEING_STEPS } from "./orderMonitoring";

/** The step list lives in the constants and in the migration's CHECK and seed; this keeps them equal. */
describe("order ageing steps", () => {
  it("match the steps the migration allows and seeds", () => {
    // The latest migration to touch the CHECK (#590 added section_3_approval) and the seeds of both.
    const original = readFileSync("supabase/migrations/20261017210000_order_ageing_rules.sql", "utf8");
    const latest = readFileSync("supabase/migrations/20261025130000_590_filing_waits_for_section3.sql", "utf8");
    const sql = original;
    const keys = ORDER_AGEING_STEPS.map((step) => step.key);
    const quoted = (text) => [...text.matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);

    const check = latest.match(/check\s*\(\s*step\s+in\s*\(([^)]*)\)/i);
    expect(check, "the migration has a CHECK on step").not.toBeNull();
    expect(quoted(check[1]).sort()).toEqual([...keys].sort());

    const seed = sql.match(/insert into[^;]*order_ageing_rules[^;]*;/i);
    const added = latest.match(/insert into[^;]*order_ageing_rules[^;]*;/i);
    expect(seed, "the migration seeds every step").not.toBeNull();
    expect(added, "the later migration seeds its own step").not.toBeNull();
    const seeded = [...quoted(seed[0]), ...quoted(added[0])].filter((key) => keys.includes(key));
    expect(seeded.sort()).toEqual([...keys].sort());
  });
});
