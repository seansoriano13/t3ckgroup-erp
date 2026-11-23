import { describe, it, expect } from "vitest";
import { IPAS_VIEW, IPAS_VIEW_LABELS, inIpasView } from "./ipasListViews";

describe("Payment Forecast view", () => {
  it("is named Payment Forecast and holds only the IPAS that are For payment", () => {
    expect(IPAS_VIEW_LABELS[IPAS_VIEW.PAYMENT_FORECAST]).toBe("Payment Forecast");
    expect(inIpasView({ figures: { paymentStatus: "for_payment" } }, IPAS_VIEW.PAYMENT_FORECAST)).toBe(true);
    expect(inIpasView({ figures: { paymentStatus: "dp_paid" } }, IPAS_VIEW.PAYMENT_FORECAST)).toBe(false);
    expect(inIpasView({ figures: { paymentStatus: null } }, IPAS_VIEW.PAYMENT_FORECAST)).toBe(false);
  });
});
