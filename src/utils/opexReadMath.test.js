import { describe, expect, it } from "vitest";
import { codeFromAccountLabel, costFromAnalyticAmount, EXPENSE_DOMAIN, expenseGroup, readP0Line } from "../../supabase/functions/_shared/opexReadMath.ts";
import { sharesFromDistribution } from "../../supabase/functions/_shared/projectTagMath.ts";

// Made-up figures only.
const names = new Map([
  [10, "S00001 Alpha Project"],
  [11, "S00002 Beta Project"],
]);
const base = { state: "purchase", onReport: false, quantity: 2, priceUnit: 100, billedQty: 2, billedPesos: 200, currencyRate: 1 };
const read = (over, distribution = { 10: 100 }) =>
  readP0Line({ ...base, shares: sharesFromDistribution(distribution, names), ...over }, "S00001");

describe("readP0Line", () => {
  it("counts a fully tagged, fully billed line at its billed pesos", () => {
    expect(read({})).toEqual({ sharePercent: 100, pesos: 200, countedPesos: 200, marks: [] });
  });

  it("counts only this S0's percent of a split line", () => {
    const out = read({ billedPesos: 1000, quantity: 1, billedQty: 1 }, { 10: 94.34, 11: 5.66 });
    expect(out.sharePercent).toBe(94.34);
    expect(out.countedPesos).toBe(943.4);
  });

  it("reads a multi-plan key as one share", () => {
    expect(read({}, { "10,99": 60, 11: 40 }).sharePercent).toBe(60);
  });

  it("counts a line tagged only to another project as nothing, and marks it", () => {
    const out = read({}, { 11: 100 });
    expect(out).toMatchObject({ sharePercent: 0, countedPesos: 0 });
    expect(out.marks).toContain("other project");
  });

  it("counts an untagged line in full when its P0 is on the report, marked no tag", () => {
    const out = read({ onReport: true }, {});
    expect(out.sharePercent).toBe(100);
    expect(out.marks).toContain("no tag");
    expect(read({ onReport: false }, {}).countedPesos).toBe(0);
  });

  it("counts an unbilled foreign line at the ordered amount at the P0's rate", () => {
    // 2 x 50 USD at 0.02 USD per peso = 5,000 pesos.
    const out = read({ priceUnit: 50, billedQty: 0, billedPesos: 0, currencyRate: 0.02 });
    expect(out.pesos).toBe(5000);
    expect(out.marks).toContain("not billed");
  });

  it("adds the unbilled part to the billed pesos and marks a partly billed line", () => {
    const out = read({ billedQty: 1, billedPesos: 90 });
    expect(out.pesos).toBe(190);
    expect(out.marks).toContain("partly billed");
  });

  it("greys out a draft or cancelled P0 and counts nothing", () => {
    for (const state of ["draft", "cancel", "sent"]) {
      const out = read({ state });
      expect(out.countedPesos).toBe(0);
      expect(out.marks).toContain("draft/cancelled");
    }
    expect(read({ state: "done" }).countedPesos).toBe(200);
  });

  it("warns on a zero price", () => {
    const out = read({ priceUnit: 0, billedQty: 0, billedPesos: 0 });
    expect(out.marks).toContain("zero price");
    expect(out.countedPesos).toBe(0);
  });
});

describe("zero price on a partly billed line", () => {
  it("flags a counted line whose ordered unit price is zero even when some was billed at zero", () => {
    const out = read({ priceUnit: 0, quantity: 2, billedQty: 1, billedPesos: 50 });
    expect(out.marks).toContain("zero price");
    expect(out.marks).toContain("partly billed");
  });
  it("does not flag a priced line", () => {
    expect(read({}).marks).not.toContain("zero price");
  });
});

describe("expenses", () => {
  // A tiny Odoo-domain reader (prefix "&" / "|", "=" / "!=" on dotted paths), enough to
  // check that EXPENSE_DOMAIN keeps and leaves out the right analytic lines.
  const valueAt = (record, path) => path.split(".").reduce((v, k) => (v == null || v === false ? false : v[k] ?? false), record);
  function matches(domain, record) {
    const items = [...domain];
    const next = () => {
      const item = items.shift();
      if (item === "&") return [next(), next()].every(Boolean);
      if (item === "|") return [next(), next()].some(Boolean);
      const [path, op, want] = item;
      const got = valueAt(record, path);
      return op === "=" ? got === want : got !== want;
    };
    const results = [];
    while (items.length) results.push(next());
    return results.every(Boolean);
  }
  const plain = { purchase_line_id: false, tax_line_id: false, move_id: { stock_move_id: false } };
  const line = (amount, move_line_id) => ({ amount, move_line_id });

  it("leaves out P0-bill lines, tax lines, stock entries and zero-amount notes", () => {
    expect(matches(EXPENSE_DOMAIN, line(-100, plain))).toBe(true);
    expect(matches(EXPENSE_DOMAIN, line(0, plain))).toBe(true);
    expect(matches(EXPENSE_DOMAIN, line(-100, { ...plain, purchase_line_id: 7 }))).toBe(false);
    expect(matches(EXPENSE_DOMAIN, line(-100, { ...plain, tax_line_id: 3 }))).toBe(false);
    expect(matches(EXPENSE_DOMAIN, line(-100, { ...plain, move_id: { stock_move_id: 9 } }))).toBe(false);
    expect(matches(EXPENSE_DOMAIN, line(0, false))).toBe(false);
    expect(matches(EXPENSE_DOMAIN, line(-5, false))).toBe(true);
  });

  it("takes the account code from Odoo's account label", () => {
    expect(codeFromAccountLabel("623010 Fuel Expenses")).toBe("623010");
    expect(codeFromAccountLabel("620001 Marketing Expense")).toBe("620001");
    expect(codeFromAccountLabel("Fuel Expenses")).toBe("");
    expect(codeFromAccountLabel("")).toBe("");
  });

  it("groups Marketing by account 620001 and everything else as Operation & Admin", () => {
    expect(expenseGroup("620001")).toBe("marketing");
    expect(expenseGroup("623005")).toBe("operation_admin");
    expect(expenseGroup(undefined)).toBe("operation_admin");
  });

  it("carries a cost as a positive amount", () => {
    expect(costFromAnalyticAmount(-123.4)).toBe(123.4);
  });
});
