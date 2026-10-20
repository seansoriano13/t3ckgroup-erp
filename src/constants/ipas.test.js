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
  it("numbers the seven parts 1 to 7 once each, in the module's order", () => {
    expect(Object.entries(IPAS_PART_NO).sort((a, b) => a[1] - b[1]).map(([part]) => part)).toEqual([
      "purchasing",
      "finance",
      "costing",
      "filing",
      "sales",
      "logistics",
      "status",
    ]);
    expect(Object.values(IPAS_PART_NO).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("names every part", () => {
    expect(Object.keys(IPAS_PART_NAMES).sort()).toEqual(Object.keys(IPAS_PART_NO).sort());
  });

  it("reads anything it doesn't know as it is given", () => {
    expect(ipasSectionLabel("nope")).toBe("nope");
  });
});

describe("ipasSectionNo (#552)", () => {
  it("maps the stored sign-off sections 1, 3 and 7 to the numbers the screen shows", () => {
    expect([1, 3, 7].map(ipasSectionNo)).toEqual([1, 2, 4]);
    expect(ipasSectionNo("3")).toBe(2);
    expect(ipasSectionWord(7)).toBe("section 4");
  });

  it("names the Settings sign-off lists with the display numbers", () => {
    expect(IPAS_SIGNER_LIST_LABELS).toEqual({
      s1_approved: "Section 1 · Approved",
      s3_approved: "Section 2 · Approved",
      s7_received: "Section 4 · Received",
      s7_noted: "Section 4 · Noted",
      s7_checked: "Section 4 · Checked",
      s7_approved: "Section 4 · Approved (files the IPAS)",
    });
  });
});

describe("ipasSectionLabel", () => {
  it("formats a part key as its number and name", () => {
    expect(ipasSectionLabel("finance")).toBe("2 · Purchasing & Finance");
    expect(ipasSectionLabel("costing")).toBe("3 · Computation status & Landed Cost");
    expect(ipasSectionLabel("filing")).toBe("4 · Filing");
    expect(ipasSectionLabel("status")).toBe("7 · Status");
  });

  it("formats a stored sign-off section the same as its part", () => {
    expect(ipasSectionLabel(1)).toBe("1 · Purchasing");
    expect(ipasSectionLabel(3)).toBe(ipasSectionLabel("finance"));
    expect(ipasSectionLabel(7)).toBe(ipasSectionLabel("filing"));
    expect(ipasSectionLabel("3")).toBe("2 · Purchasing & Finance");
  });

  it("uses the middle dot with a space either side", () => {
    for (const part of Object.keys(IPAS_PART_NO)) {
      expect(ipasSectionLabel(part)).toMatch(/^\d · \S/);
    }
  });
});
