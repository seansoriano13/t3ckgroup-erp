import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// readOpexReport against a fake Odoo (#1266). Made-up figures only.
// odoo.ts reads its settings from Deno.env when it loads, so Deno is stubbed first.

let readOpexReport;
let calls = [];

function fakeOdoo(model, method, args) {
  const key = `${model}.${method}`;
  switch (key) {
    case "account.analytic.plan.search_read":
      return [{ id: 5 }];
    case "sale.order.search_read":
      return [{ id: 1, name: "S00001", amount_untaxed: 1000 }];
    case "purchase.order.search_read":
      return args[0][0][0] === "origin" ? [{ id: 10, origin: "S00001" }] : [];
    case "account.analytic.line.fields_get":
      return { x_plan5_id: {}, account_id: {} };
    case "account.analytic.account.search_read":
      return [{ id: 100, name: "S00001 Alpha Project" }];
    case "account.analytic.account.read":
      return [{ id: 100, name: "S00001 Alpha Project" }];
    case "purchase.order.line.search_read":
      return [
        {
          id: 200,
          order_id: [10, "P00010"],
          name: "Widget",
          product_id: [1, "Widget"],
          product_qty: 2,
          price_unit: 100,
          analytic_distribution: { 100: 100 },
        },
      ];
    case "purchase.order.read":
      return [{ id: 10, name: "P00010", state: "purchase", partner_id: [3, "Supplier A"], currency_rate: 1 }];
    case "account.move.line.search_read":
      return [{ purchase_line_id: [200, "x"], quantity: 2, balance: 200, move_id: [600, "BILL/1"], move_type: "in_invoice" }];
    case "account.move.line.read":
      return [{ id: 400, purchase_line_id: false, tax_line_id: false, move_id: [500, "MISC/1"] }];
    case "account.move.read":
      return [{ id: 500, stock_move_id: false }];
    case "account.account.read":
      return [{ id: 7, code: "6100" }];
    default:
      throw new Error(`fake Odoo has no answer for ${key}`);
  }
}

// The test config undoes stubs before each test, so they are set in beforeEach.
function stubOdoo() {
  vi.stubGlobal("Deno", { env: { get: (k) => ({ ODOO_URL: "https://odoo.test", ODOO_DB: "db" })[k] } });
  vi.stubGlobal("fetch", async (_url, init) => {
    const { service, args } = JSON.parse(init.body).params;
    let result;
    if (service === "common") result = 1;
    else {
      const [, , , model, odooMethod, odooArgs] = args;
      calls.push(`${model}.${odooMethod}`);
      if (model === "account.analytic.line" && odooMethod === "search_read") {
        result = [{ id: 300, date: "2026-11-01", name: "Fuel", amount: -500, general_account_id: [7, "Fuel"], move_line_id: [400, "x"] }];
      } else {
        result = fakeOdoo(model, odooMethod, odooArgs);
      }
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
}

beforeAll(async () => {
  stubOdoo();
  ({ readOpexReport } = await import("../../supabase/functions/_shared/odooOpexRead.ts"));
});

beforeEach(() => stubOdoo());

describe("readOpexReport", () => {
  it("asks Odoo for the Projects plan and its column only once per warm function", async () => {
    await readOpexReport(1, { s0: "S00001", handP0s: [], vatDivisor: 1.12 });
    calls = [];
    await readOpexReport(1, { s0: "S00001", handP0s: [], vatDivisor: 1.12 });

    expect(calls).not.toContain("account.analytic.plan.search_read");
    expect(calls).not.toContain("account.analytic.line.fields_get");
  });

  it("reads the bill type with the bill lines, not in a call of its own", async () => {
    calls = [];
    await readOpexReport(1, { s0: "S00001", handP0s: [], vatDivisor: 1.12 });

    // One account.move read is left: the expenses' stock check.
    expect(calls.filter((c) => c === "account.move.read")).toHaveLength(1);
    expect(calls).toHaveLength(12);
  });

  it("reads the P0 lines and the expenses of one S0", async () => {
    const report = await readOpexReport(1, { s0: "S00001", handP0s: [], vatDivisor: 1.12 });

    expect(report).toMatchObject({
      s0: "S00001",
      projectName: "Alpha Project",
      noProjectTag: false,
      saleOrderFound: true,
      odooContractPrice: 1120,
    });
    expect(report.lines).toEqual([expect.objectContaining({ lineId: 200, p0: "P00010", supplier: "Supplier A", sharePercent: 100 })]);
    expect(report.expenses).toEqual([
      expect.objectContaining({ analyticLineId: 300, amount: 500, accountCode: "6100", group: "operation_admin" }),
    ]);
  });
});
