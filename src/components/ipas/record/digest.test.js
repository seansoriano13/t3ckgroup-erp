import { describe, expect, it } from "vitest";

import { sectionState } from "./digest";

/** #1124: a Landed Cost taken from estimates is never called Final. */
describe("sectionState: the Costs card", () => {
  const costs = (over) => sectionState("costs", { costsComplete: true, landedEstimate: false, landedUnavailable: false, ...over });

  it("reads Final once the pesos are all in", () => {
    expect(costs({})).toMatchObject({ detail: "Final" });
  });

  it("reads Estimate while a payment's pesos are blank", () => {
    expect(costs({ landedEstimate: true })).toMatchObject({ detail: "Estimate" });
  });

  it("reads Provisional before LC Odoo Done", () => {
    expect(costs({ costsComplete: false })).toMatchObject({ detail: "Provisional" });
  });
});
