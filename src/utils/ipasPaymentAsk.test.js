import { describe, it, expect } from "vitest";
import { ipasFigures } from "./ipasFigures";
import { askPriorityRank, comparePaymentForecast, paymentAskHover } from "./ipasPaymentAsk";

const withAsk = (ask) => ({ figures: { paymentAsk: ask } });

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
