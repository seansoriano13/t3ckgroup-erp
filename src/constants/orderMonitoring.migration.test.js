import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ORDER_AGEING_STEPS } from "./orderMonitoring";

/** The step list lives in the constants and in the migration's CHECK and seed; this keeps them equal. */
describe("order ageing steps", () => {
  it("match the steps the migration allows and seeds", () => {
    const sql = readFileSync("supabase/migrations/20261017210000_order_ageing_rules.sql", "utf8");
    const keys = ORDER_AGEING_STEPS.map((step) => step.key);
    const quoted = (text) => [...text.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    const check = sql.match(/check\s*\(\s*step\s+in\s*\(([^)]*)\)/i);
    expect(check, "the migration has a CHECK on step").not.toBeNull();
    expect(quoted(check[1]).sort()).toEqual([...keys].sort());

    const seed = sql.match(/insert into[^;]*order_ageing_rules[^;]*;/i);
    expect(seed, "the migration seeds every step").not.toBeNull();
    expect(quoted(seed[0]).filter((key) => keys.includes(key)).sort()).toEqual([...keys].sort());
  });
});
