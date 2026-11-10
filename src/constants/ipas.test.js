import { describe, expect, it } from "vitest";
import {
  IPAS_PART_NAMES,
  IPAS_PART_NO,
  IPAS_SIGNER_LIST_LABELS,
  ipasSectionLabel,
  ipasSectionNo,
  ipasSectionWord,
} from "./ipas";

/**
 * The one place a section's number and name come from. The stored sign-off
 * sections (1, 3, 7) are keys in the database; a person reads the numbers here.
 */
describe("the IPAS section numbers", () => {
  it("numbers the parts 1 to 6 in the order the work happens: Order, Payments, Costs, Delivery, Documents, Sign-offs", () => {
    const byNumber = (no) => Object.entries(IPAS_PART_NO).filter(([, n]) => n === no).map(([part]) => part).sort();
    expect(byNumber(1)).toEqual(["purchasing", "sales"]);
    expect(byNumber(2)).toEqual(["finance"]);
    expect(byNumber(3)).toEqual(["costing"]);
    expect(byNumber(4)).toEqual(["logistics", "status"]);
    expect(byNumber(5)).toEqual(["documents"]);
    expect(byNumber(6)).toEqual(["filing"]);
    expect([...new Set(Object.values(IPAS_PART_NO))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("names every part", () => {
    expect(Object.keys(IPAS_PART_NAMES).sort()).toEqual(Object.keys(IPAS_PART_NO).sort());
  });

  it("reads anything it doesn't know as it is given", () => {
    expect(ipasSectionLabel("nope")).toBe("nope");
  });
});

describe("ipasSectionNo (#552)", () => {
  it("maps the stored sign-off sections 1, 3, 6, 7 and 8 to the numbers the screen shows", () => {
    expect([1, 3, 6, 7, 8].map(ipasSectionNo)).toEqual([1, 2, 3, 6, 4]);
    expect(ipasSectionNo("3")).toBe(2);
    expect(ipasSectionWord(7)).toBe("section 6");
  });

  it("names the Settings sign-off lists after the rail's sign-offs", () => {
    expect(IPAS_SIGNER_LIST_LABELS).toEqual({
      s1_approved: "Approve · 1 Order",
      s3_approved: "Approve · 2 Payments",
      s6_approved: "Approve · 3 Costs",
      s7_received: "Check (as Received)",
      s7_noted: "Check (as Noted)",
      s7_checked: "Check (as Checked)",
      s7_approved: "Approve and file",
      logistics_signed: "Sign Logistics · 4 Delivery",
    });
  });
});

describe("ipasSectionLabel", () => {
  it("formats a part key as its number and name", () => {
    expect(ipasSectionLabel("finance")).toBe("2 · Payments");
    expect(ipasSectionLabel("costing")).toBe("3 · Costs");
    expect(ipasSectionLabel("filing")).toBe("6 · Sign-offs");
    expect(ipasSectionLabel("status")).toBe("4 · Delivery");
  });

  it("formats a stored sign-off section the same as its part", () => {
    expect(ipasSectionLabel(1)).toBe("1 · Order");
    expect(ipasSectionLabel(3)).toBe(ipasSectionLabel("finance"));
    expect(ipasSectionLabel(7)).toBe(ipasSectionLabel("filing"));
    expect(ipasSectionLabel("3")).toBe("2 · Payments");
  });

  it("uses the middle dot with a space either side", () => {
    for (const part of Object.keys(IPAS_PART_NO)) {
      expect(ipasSectionLabel(part)).toMatch(/^\d · \S/);
    }
  });
});
