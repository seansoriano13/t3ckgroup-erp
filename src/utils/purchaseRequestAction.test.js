import { describe, it, expect } from "vitest";
import {
  BUYER_COSTING_INCHARGE,
  BUYER_EMPLOYEE,
  DEFAULT_REQUESTERS,
  extraRequesters,
  purchaseRequestSummary,
} from "./purchaseRequestAction";

describe("purchaseRequestSummary", () => {
  it("reads as one line", () => {
    expect(purchaseRequestSummary({})).toBe("No default Buyer");
    expect(purchaseRequestSummary({ buyer: { type: BUYER_COSTING_INCHARGE } })).toBe(
      "Buyer: the S0 Evaluation's Purchasing Incharge",
    );
  });

  it("names a configured Buyer", () => {
    const names = { e1: "Ana Cruz" };
    expect(purchaseRequestSummary({ buyer: { type: BUYER_EMPLOYEE, id: "e1" } }, (id) => names[id])).toBe(
      "Buyer: Ana Cruz",
    );
  });
});

describe("extraRequesters", () => {
  it("is nobody when the setting is absent, empty, or only Deal Team roles", () => {
    expect(extraRequesters(undefined)).toEqual([]);
    expect(extraRequesters([])).toEqual([]);
    expect(extraRequesters(DEFAULT_REQUESTERS)).toEqual([]);
  });

  it("keeps the people the setting adds on top of the Deal Team", () => {
    const person = { type: "employee", id: "e1" };
    const dept = { type: "department", department: "Finance" };
    expect(extraRequesters([{ type: "role", role: "deal_owner" }, person, dept])).toEqual([person, dept]);
  });
});
