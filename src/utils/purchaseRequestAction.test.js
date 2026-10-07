import { describe, it, expect } from "vitest";
import { BUYER_COSTING_INCHARGE, BUYER_EMPLOYEE, purchaseRequestSummary } from "./purchaseRequestAction";

describe("purchaseRequestSummary", () => {
  it("reads as one line", () => {
    expect(purchaseRequestSummary({})).toBe("No default Buyer");
    expect(purchaseRequestSummary({ buyer: { type: BUYER_COSTING_INCHARGE } })).toBe(
      "Buyer: the Costing Matrix's Purchasing Incharge",
    );
  });

  it("names a configured Buyer", () => {
    const names = { e1: "Ana Cruz" };
    expect(purchaseRequestSummary({ buyer: { type: BUYER_EMPLOYEE, id: "e1" } }, (id) => names[id])).toBe(
      "Buyer: Ana Cruz",
    );
  });
});
