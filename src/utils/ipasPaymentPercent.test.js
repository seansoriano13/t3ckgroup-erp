import { describe, expect, it } from "vitest";
import {
  PERCENT_BASE,
  afterPercentEdit,
  amountFromPercent,
  formatPercent,
  parsePercentInput,
  paymentKindWithPercent,
  paymentWarnings,
  percentApplies,
  percentBase,
} from "./ipasPaymentPercent";

describe("which kinds can be a percent", () => {
  it("is Down payment and Payment only", () => {
    expect(percentApplies("down_payment")).toBe(true);
    expect(percentApplies("payment")).toBe(true);
    expect(percentApplies("full_payment")).toBe(false);
    expect(percentApplies("shipping_fee")).toBe(false);
  });
});

describe("percentBase", () => {
  it("is the P.I/QT Amount when it is given", () => {
    expect(percentBase({ piQtAmount: 2000, poTotal: 1500 })).toMatchObject({ source: PERCENT_BASE.PI_QT, amount: 2000 });
  });
  it("is the PO total when the P.I/QT Amount is blank, zero or missing", () => {
    for (const blank of [null, undefined, "", 0]) {
      expect(percentBase({ piQtAmount: blank, poTotal: 1500 })).toMatchObject({ source: PERCENT_BASE.PO_TOTAL, amount: 1500 });
    }
  });
  it("is null when neither is known", () => {
    expect(percentBase({ piQtAmount: null, poTotal: null })).toBeNull();
    expect(percentBase()).toBeNull();
  });
});

describe("amountFromPercent", () => {
  it("works out percent x base", () => {
    expect(amountFromPercent(30, { amount: 1000 })).toBe(300);
    expect(amountFromPercent("45", 2000)).toBe(900);
  });
  it("rounds to the centavo", () => {
    expect(amountFromPercent(33.3333, { amount: 1000.01 })).toBe(333.34);
    expect(amountFromPercent(12.5, { amount: 0.03 })).toBe(0);
    expect(amountFromPercent(30, { amount: 123.45 })).toBe(37.04);
  });
  it("is null without a usable percent or base", () => {
    expect(amountFromPercent("", { amount: 1000 })).toBeNull();
    expect(amountFromPercent("abc", { amount: 1000 })).toBeNull();
    expect(amountFromPercent(0, { amount: 1000 })).toBeNull();
    expect(amountFromPercent(30, null)).toBeNull();
  });
});

describe("reading and showing a percent", () => {
  it("reads typed text, with or without a % sign", () => {
    expect(parsePercentInput("30%")).toEqual({ ok: true, value: 30 });
    expect(parsePercentInput(" 12.5 ")).toEqual({ ok: true, value: 12.5 });
    expect(parsePercentInput("")).toEqual({ ok: true, value: null });
    expect(parsePercentInput("0").ok).toBe(false);
    expect(parsePercentInput("-5").ok).toBe(false);
    expect(parsePercentInput("x").ok).toBe(false);
  });
  it("shows 30, 12.5 and 33.3333 without trailing zeros", () => {
    expect(formatPercent(30)).toBe("30");
    expect(formatPercent("12.50")).toBe("12.5");
    expect(formatPercent(33.3333)).toBe("33.3333");
    expect(formatPercent(null)).toBe("");
  });
  it("puts the percent beside the kind", () => {
    expect(paymentKindWithPercent("payment", 30)).toBe("Payment · 30%");
    expect(paymentKindWithPercent("down_payment", "12.50")).toBe("Down payment · 12.5%");
    expect(paymentKindWithPercent("payment", null)).toBe("Payment");
    expect(paymentKindWithPercent("full_payment", 30)).toBe("Full payment");
  });
});

describe("afterPercentEdit", () => {
  const base = { source: PERCENT_BASE.PI_QT, amount: 1000 };
  it("typing a percent fills the amount", () => {
    expect(afterPercentEdit({}, { field: "percent", value: "30", base })).toEqual({ percentOfOrder: "30", amount: "300" });
  });
  it("typing a percent with no base keeps the amount as it was", () => {
    expect(afterPercentEdit({}, { field: "percent", value: "30", base: null })).toEqual({ percentOfOrder: "30" });
  });
  it("clearing the percent leaves the amount alone", () => {
    expect(afterPercentEdit({ amount: "300" }, { field: "percent", value: "", base })).toEqual({ percentOfOrder: "" });
  });
  it("typing a different amount by hand clears the percent", () => {
    expect(afterPercentEdit({ percentOfOrder: "30", amount: "300" }, { field: "amount", value: "310", base })).toEqual({
      amount: "310",
      percentOfOrder: "",
    });
  });
  it("re-typing the figure the percent filled keeps the percent", () => {
    expect(afterPercentEdit({ percentOfOrder: "30", amount: "300" }, { field: "amount", value: "300", base })).toEqual({ amount: "300" });
  });
  it("changing to a kind that cannot carry a percent clears it", () => {
    expect(afterPercentEdit({ percentOfOrder: "30" }, { field: "kind", value: "full_payment" })).toEqual({ kind: "full_payment", percentOfOrder: "" });
    expect(afterPercentEdit({ percentOfOrder: "30" }, { field: "kind", value: "down_payment" })).toEqual({ kind: "down_payment" });
  });
});

describe("paymentWarnings", () => {
  it("is quiet when the percents and amounts fit the order", () => {
    const rows = [
      { amount: "300", percentOfOrder: "30" },
      { amount: "450", percentOfOrder: "45" },
      { amount: "250", percentOfOrder: "25" },
    ];
    expect(paymentWarnings(rows, 1000)).toEqual({ percentOver: null, amountOver: null });
  });
  it("warns when the percents pass 100%", () => {
    const rows = [{ percentOfOrder: "60" }, { percent_of_order: 50 }];
    expect(paymentWarnings(rows, null).percentOver).toEqual({ total: 110 });
  });
  it("warns when the payments pass the order amount", () => {
    const rows = [{ amount: "600" }, { amount: "500.50" }];
    expect(paymentWarnings(rows, 1000).amountOver).toEqual({ paid: 1100.5, order: 1000, over: 100.5 });
  });
  it("does not warn about the amount when the order amount is unknown", () => {
    expect(paymentWarnings([{ amount: "600" }], null).amountOver).toBeNull();
  });
  it("adds centavos without drift", () => {
    const rows = [{ amount: "0.1" }, { amount: "0.2" }];
    expect(paymentWarnings(rows, 0.3).amountOver).toBeNull();
  });
});
