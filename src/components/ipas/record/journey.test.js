import { describe, expect, it } from "vitest";

import { IPAS_COMPUTATION_STATUS } from "@/constants/ipas";

import { journeyFor } from "./journey";

const digest = {
  docs: { missingByPart: {} },
  money: { landedText: "₱100.00", landedFigureText: "₱100.00" },
  costsComplete: false,
  landedUnavailable: false,
  s1: {},
  s3: {},
  s6: {},
  s7: {},
  s8: null,
};

const build = (charges, can = { change: true, record: true }) =>
  journeyFor({ ipas: { charges, slips: [], source: "local" }, digest, lists: {}, userId: "u1", can });
const landed = (journey) => journey.ready.find((item) => item.key === "landed");

describe("rail: Mark Landed Cost final", () => {
  it("is replaced by a Fill in 3 · Costs link, with the reason, while a charge has no amount", () => {
    const item = landed(build([{ amount_php: null }, { amount_php: 5, attachment_url: "x" }]));

    expect(item.action).toEqual({ kind: "edit", section: "costs", label: "Fill in 3 · Costs" });
    expect(item.line).toMatch(/no amount/);
  });

  it("treats undefined as blank too", () => {
    expect(landed(build([{}])).action.label).toBe("Fill in 3 · Costs");
  });

  it("counts 0 as filled and offers the final button", () => {
    const item = landed(build([{ amount_php: 0, attachment_url: "x" }]));

    expect(item.action).toMatchObject({ kind: "landed", status: IPAS_COMPUTATION_STATUS.LC_ODOO_DONE });
  });
});
