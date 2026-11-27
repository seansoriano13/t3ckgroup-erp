import { describe, it, expect } from "vitest";
import { ipasFigures } from "./ipasFigures";
import { askLine, askPurposeLocks, askWhat, askPriorityLabel, askPriorityOptions, askPriorityRank, chargeAsks, comparePaymentForecast, paidKindForAsk, payableAsks, paymentAskHover } from "./ipasPaymentAsk";

const withAsk = (ask) => ({ figures: { paymentAsk: ask } });

describe("the kind Record as paid fills (#1225)", () => {
  it("fills Down payment for a Down payment ask", () => {
    expect(paidKindForAsk({ purpose: "down_payment", amount: 100 }, 1000)).toBe("down_payment");
  });

  it("fills Full payment only when a Balance pays off what is left", () => {
    expect(paidKindForAsk({ purpose: "balance", amount: 1000 }, 1000)).toBe("full_payment");
    expect(paidKindForAsk({ purpose: "balance", amount: 1200 }, 1000)).toBe("full_payment");
    expect(paidKindForAsk({ purpose: "balance", amount: 999.99 }, 1000)).toBe("payment");
    expect(paidKindForAsk({ purpose: "balance", amount: 500 }, null)).toBe("payment");
    expect(paidKindForAsk({ purpose: "balance", amount: 500 }, 0)).toBe("payment");
  });
});

describe("Full payment requests (#1280)", () => {
  it("is labelled Full payment and Record as paid fills the kind Full payment", () => {
    expect(askWhat({ purpose: "full_payment" })).toBe("Full payment");
    expect(paidKindForAsk({ purpose: "full_payment", amount: 100 }, 1000)).toBe("full_payment");
  });

  it("greys Full payment once anything is paid or asked, never for withdrawn or Charge asks", () => {
    expect(askPurposeLocks({ payments: [], payment_asks: [] })).toEqual({ full_payment: null, down_payment: null, balance: null });
    expect(askPurposeLocks({ payments: [{ id: "p" }], payment_asks: [] }).full_payment).toMatch(/Use Balance for the rest/);
    expect(askPurposeLocks({ payments: [], payment_asks: [{ purpose: "balance", closed_at: null }] }).full_payment).toMatch(/already a payment or an open request/);
    expect(askPurposeLocks({ payments: [], payment_asks: [{ purpose: "down_payment", closed_reason: "withdrawn" }] }).full_payment).toBeNull();
    expect(askPurposeLocks({ payments: [], payment_asks: [{ purpose: "charge", closed_at: null }] }).full_payment).toBeNull();
  });

  it("greys Down payment and Balance while a Full payment ask is open or paid, not once withdrawn", () => {
    const open = askPurposeLocks({ payments: [], payment_asks: [{ purpose: "full_payment", closed_at: null }] });
    expect(open.down_payment).toBe("A Full payment is already asked.");
    expect(open.balance).toBe("A Full payment is already asked.");
    expect(askPurposeLocks({ payments: [{ id: "p" }], payment_asks: [{ purpose: "full_payment", closed_reason: "paid" }] }).balance).not.toBeNull();
    expect(askPurposeLocks({ payments: [], payment_asks: [{ purpose: "full_payment", closed_reason: "withdrawn" }] }).balance).toBeNull();
  });
});

describe("Payment Forecast order (#1208)", () => {
  it("lists Very High first, then High, then Medium", () => {
    expect(askPriorityRank("very_high")).toBeLessThan(askPriorityRank("high"));
    expect(askPriorityRank("high")).toBeLessThan(askPriorityRank("medium"));
    const rows = [
      { id: "m", ...withAsk({ priority: "medium", asked_at: "2026-11-01T00:00:00Z" }) },
      { id: "v", ...withAsk({ priority: "very_high", asked_at: "2026-11-09T00:00:00Z" }) },
      { id: "h", ...withAsk({ priority: "high", asked_at: "2026-11-05T00:00:00Z" }) },
    ];
    expect(rows.sort(comparePaymentForecast).map((r) => r.id)).toEqual(["v", "h", "m"]);
  });

  it("puts the oldest ask first within a priority", () => {
    const rows = [
      { id: "new", ...withAsk({ priority: "high", asked_at: "2026-11-09T00:00:00Z" }) },
      { id: "old", ...withAsk({ priority: "high", asked_at: "2026-11-02T00:00:00Z" }) },
    ];
    expect(rows.sort(comparePaymentForecast).map((r) => r.id)).toEqual(["old", "new"]);
  });
});

describe("the ask's hover line (#1208)", () => {
  it("names the percent and the priority", () => {
    const figures = ipasFigures({
      state: "open",
      pi_qt_amount: 10000,
      odoo_copy: { po: { currency: "USD" } },
      payment_asks: [{ amount: 4000, purpose: "down_payment", note: null, priority: "very_high", percent_of_order: 40, closed_at: null }],
    });
    const text = paymentAskHover(figures);
    expect(text).toContain("Down payment");
    expect(text).toContain("40% of the order");
    expect(text).toContain("Very High priority");
  });

  it("leaves the percent out when none was typed", () => {
    const figures = ipasFigures({ state: "open", payment_asks: [{ amount: 100, purpose: "balance", priority: "high", closed_at: null }] });
    expect(paymentAskHover(figures)).not.toContain("% of the order");
    expect(paymentAskHover(figures)).toContain("High priority");
  });
});

describe("several open asks (#1224)", () => {
  const rowOf = (id, asks) => ({ id, figures: ipasFigures({ state: "open", payment_asks: asks }) });

  it("shows an IPAS once and sorts it by its most urgent open ask, then its oldest", () => {
    const rows = [
      // High and Medium: its best ask is High, and its oldest ask (the Medium one) is older than c's.
      rowOf("a", [
        { priority: "medium", asked_at: "2026-11-01T00:00:00Z", amount: 1, purpose: "balance" },
        { priority: "high", asked_at: "2026-11-08T00:00:00Z", amount: 1, purpose: "down_payment" },
      ]),
      // Only Very High; a closed High ask older than everything does not count.
      rowOf("b", [
        { priority: "very_high", asked_at: "2026-11-09T00:00:00Z", amount: 1, purpose: "down_payment" },
        { priority: "high", asked_at: "2026-10-01T00:00:00Z", amount: 1, purpose: "balance", closed_at: "2026-10-02T00:00:00Z" },
      ]),
      rowOf("c", [{ priority: "high", asked_at: "2026-11-03T00:00:00Z", amount: 1, purpose: "down_payment" }]),
    ];
    expect(rows.sort(comparePaymentForecast).map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("lists each open ask on its own line in the hover, most urgent first", () => {
    const figures = ipasFigures({
      state: "open",
      payment_asks: [
        { amount: 100, purpose: "balance", priority: "medium", asked_at: "2026-11-01T00:00:00Z", closed_at: null },
        { amount: 200, purpose: "down_payment", priority: "very_high", asked_at: "2026-11-02T00:00:00Z", closed_at: null },
        { amount: 300, purpose: "balance", priority: "high", asked_at: "2026-11-03T00:00:00Z", closed_at: "2026-11-04T00:00:00Z" },
      ],
    });
    const lines = paymentAskHover(figures).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("Down payment");
    expect(lines[1]).toContain("Balance");
  });

  it("reads For payment while any ask is open, and the paid/left split ignores open asks", () => {
    const base = { state: "open", pi_qt_amount: 1000, odoo_copy: { po: { currency: "PHP" } } };
    const paid = [{ kind: "down_payment", amount: 300, paid_on: "2026-11-01" }];
    const one = ipasFigures({ ...base, payments: paid, payment_asks: [{ amount: 500, purpose: "balance", priority: "high", closed_at: null }] });
    expect(one.paymentStatus).toBe("for_payment");
    expect(one.paymentAsks).toHaveLength(1);
    const none = ipasFigures({ ...base, payments: paid, payment_asks: [{ amount: 500, purpose: "balance", priority: "high", closed_at: "2026-11-02T00:00:00Z", closed_reason: "paid" }] });
    expect(none.paymentStatus).toBe("dp_paid");
    expect(none.paymentAsks).toEqual([]);
    expect(one.paid).toBe(300);
    expect(one.paidPercent).toBe(none.paidPercent);
  });
});

describe("Charge asks (#1227)", () => {
  const chargeAsk = { id: "a-c", purpose: "charge", amount: 700, currency: "USD", priority: "high", charge_kind: { label: "Brokerage Fee" }, asked_at: "2026-11-02T00:00:00Z", closed_at: null };
  const supplierAsk = { id: "a-s", purpose: "down_payment", amount: 500, priority: "high", asked_at: "2026-11-01T00:00:00Z", closed_at: null };

  it("names a Charge ask by its kind and shows it in its own currency", () => {
    const line = askLine(chargeAsk, "EUR");
    expect(line).toContain("Brokerage Fee");
    expect(line).toContain("700.00");
    expect(line).not.toContain("€");
  });

  it("keeps Charge asks out of what a payment can pay, and supplier asks out of what a charge can pay", () => {
    const ipas = { payment_asks: [chargeAsk, supplierAsk, { ...supplierAsk, id: "a-x", closed_at: "2026-11-03T00:00:00Z" }] };
    expect(payableAsks(ipas).map((ask) => ask.id)).toEqual(["a-s"]);
    expect(chargeAsks(ipas).map((ask) => ask.id)).toEqual(["a-c"]);
  });

  it("lists each Charge ask in its own currency on the forecast hover, never summed", () => {
    const figures = ipasFigures({
      state: "open",
      odoo_copy: { po: { currency: "EUR" } },
      payment_asks: [chargeAsk, { ...chargeAsk, id: "a-d", currency: "PHP", amount: 900, priority: "medium" }, supplierAsk],
    });
    const lines = paymentAskHover(figures).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.filter((line) => line.includes("Brokerage Fee"))).toHaveLength(2);
    expect(lines.some((line) => line.includes("900.00"))).toBe(true);
    expect(lines.some((line) => line.includes("700.00"))).toBe(true);
  });
});

describe("the priority helpers", () => {
  it("lists the priorities most urgent first, with their labels", () => {
    expect(askPriorityOptions().map((option) => option.value)).toEqual(["very_high", "high", "medium"])
    expect(askPriorityOptions()[0].label).toBe("Very High")
  })

  it("labels a priority, and shows an unknown one as it is", () => {
    expect(askPriorityLabel("medium")).toBe("Medium")
    expect(askPriorityLabel("urgent")).toBe("urgent")
  })
})
