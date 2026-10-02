import { describe, it, expect } from "vitest";
import {
  changedColumns,
  keepKnownValues,
  needsNoteReread,
  selectRereadOrders,
} from "../../supabase/functions/_shared/noteReread.ts";
import { incomeStatus } from "./retailReport";

const order = (overrides = {}) => ({
  odoo_so_number: "S1",
  odoo_so_id: 1,
  amount: 1000,
  order_income: 800,
  marketplace_fee: 100,
  ...overrides,
});

describe("needsNoteReread", () => {
  it("is false for an order whose income reads as OK", () => {
    expect(needsNoteReread(order())).toBe(false);
    // Income equal to the Order Amount is still OK, not Suspect.
    expect(needsNoteReread(order({ order_income: 1000, marketplace_fee: null }))).toBe(false);
  });

  it("is true for Missing Income: no Order Income at all", () => {
    expect(needsNoteReread(order({ order_income: null }))).toBe(true);
  });

  it("is true for Suspect Income: income above the Order Amount", () => {
    expect(needsNoteReread(order({ order_income: 1000.01 }))).toBe(true);
  });

  it("is true for Suspect Income: Marketplace Fee at least the Order Amount", () => {
    expect(needsNoteReread(order({ marketplace_fee: 1000 }))).toBe(true);
    expect(needsNoteReread(order({ marketplace_fee: 999.99 }))).toBe(false);
  });

  it("reads numeric strings the way PostgREST can hand them back", () => {
    expect(needsNoteReread(order({ amount: "1000", order_income: "1200" }))).toBe(true);
  });

  // The screen derives Missing/Suspect in src/utils/retailReport.js; the sync
  // cannot import that file, so this keeps the two rules from drifting apart.
  it("agrees with the report's income status on every boundary", () => {
    const amounts = [0, 500, 1000];
    const incomes = [null, 0, 499.99, 500, 500.01, 999.99, 1000, 1000.01, 2000];
    const fees = [null, 0, 499.99, 500, 999.99, 1000, 1500];
    for (const amount of amounts) {
      for (const order_income of incomes) {
        for (const marketplace_fee of fees) {
          const o = order({ amount, order_income, marketplace_fee });
          expect(needsNoteReread(o), JSON.stringify(o)).toBe(incomeStatus(o) !== "ok");
        }
      }
    }
  });
});

describe("selectRereadOrders", () => {
  const stored = [
    order({ odoo_so_number: "S1", odoo_so_id: 1 }), // OK
    order({ odoo_so_number: "S2", odoo_so_id: 2, order_income: null }), // Missing
    order({ odoo_so_number: "S3", odoo_so_id: 3, order_income: 5000 }), // Suspect
    order({ odoo_so_number: "S4", odoo_so_id: 4, order_income: null }), // Missing
  ];
  const numbers = (rows) => rows.map((r) => r.odoo_so_number);

  it("picks the Missing and Suspect orders, and leaves the OK ones alone", () => {
    expect(numbers(selectRereadOrders(stored))).toEqual(["S2", "S3", "S4"]);
  });

  it("also picks an OK order whose notes were touched, so an edited note is caught", () => {
    expect(numbers(selectRereadOrders(stored, new Set([1])))).toEqual(["S1", "S2", "S3", "S4"]);
  });

  it("does not pick a touched id that is not stored", () => {
    expect(numbers(selectRereadOrders(stored, new Set([99])))).toEqual(["S2", "S3", "S4"]);
  });

  it("leaves out ids the caller is already reading, so no order is read twice", () => {
    expect(numbers(selectRereadOrders(stored, new Set([1]), new Set([1, 3])))).toEqual(["S2", "S4"]);
  });

  it("leaves out an order with no Odoo id: there is nothing to look it up by", () => {
    const rows = [order({ odoo_so_number: "S9", odoo_so_id: null, order_income: null }), ...stored];
    expect(numbers(selectRereadOrders(rows))).toEqual(["S2", "S3", "S4"]);
  });
});

describe("keepKnownValues", () => {
  const prior = {
    buyer_name: "Ana",
    marketplace_order_id: "ABC1",
    marketplace_fee: 50,
    order_income: 450,
  };
  const fact = (overrides = {}) => ({
    buyer: null,
    marketplaceOrderId: null,
    marketplaceFee: null,
    orderIncome: null,
    ...overrides,
  });

  it("keeps the stored value when the read finds nothing", () => {
    expect(keepKnownValues(prior, fact())).toEqual(prior);
    expect(keepKnownValues(prior, undefined)).toEqual(prior);
  });

  it("lets a newly read value overwrite the stored one, so a corrected note corrects the figure", () => {
    expect(keepKnownValues(prior, fact({ orderIncome: 400, marketplaceFee: 100 }))).toEqual({
      ...prior,
      marketplace_fee: 100,
      order_income: 400,
    });
  });

  it("treats a read zero as a value, not as nothing", () => {
    expect(keepKnownValues(prior, fact({ marketplaceFee: 0 })).marketplace_fee).toBe(0);
  });

  it("starts from nothing for an order not stored yet", () => {
    expect(keepKnownValues(undefined, fact({ buyer: "Ben", orderIncome: 90 }))).toEqual({
      buyer_name: "Ben",
      marketplace_order_id: null,
      marketplace_fee: null,
      order_income: 90,
    });
  });
});

describe("changedColumns", () => {
  const stored = {
    odoo_so_number: "S1",
    amount: 1000,
    ordered_at: "2026-09-02T03:04:05+00:00",
    order_income: 800,
    buyer_name: null,
  };

  it("is null when nothing differs, so the row is not written", () => {
    expect(changedColumns(stored, { ...stored })).toBeNull();
  });

  it("sees the same instant through a different timestamp spelling as unchanged", () => {
    expect(changedColumns(stored, { ...stored, ordered_at: "2026-09-02T03:04:05Z" })).toBeNull();
  });

  it("sees a numeric string and a number of equal value as unchanged", () => {
    expect(changedColumns(stored, { ...stored, amount: "1000.00" })).toBeNull();
  });

  it("returns only the columns that differ", () => {
    expect(changedColumns(stored, { ...stored, order_income: 750, buyer_name: "Ana" })).toEqual({
      order_income: 750,
      buyer_name: "Ana",
    });
  });

  it("sees null becoming a value, and 0 as different from null", () => {
    expect(changedColumns(stored, { ...stored, buyer_name: "" })).toEqual({ buyer_name: "" });
    expect(changedColumns({ ...stored, order_income: null }, { ...stored, order_income: 0 })).toEqual({
      order_income: 0,
    });
  });

  it("returns the whole row for an order not stored yet", () => {
    expect(changedColumns(undefined, stored)).toEqual(stored);
  });
});
