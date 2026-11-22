import { describe, expect, it } from "vitest";

import { digestIpas, sectionState } from "./digest";
import { makePrintableIpas } from "@/test/ipasPrint";

/** #1124: a Landed Cost taken from estimates is never called Final. */
describe("sectionState: the Costs card", () => {
  const costs = (over) => sectionState("costs", { costsComplete: true, landedUnavailable: false, money: { landedEstimate: false }, ...over });

  it("reads Final once the pesos are all in", () => {
    expect(costs({})).toMatchObject({ detail: "Final" });
  });

  it("reads Estimate while a payment's pesos are blank", () => {
    expect(costs({ money: { landedEstimate: true } })).toMatchObject({ detail: "Estimate" });
  });

  it("reads Provisional before LC Odoo Done", () => {
    expect(costs({ costsComplete: false })).toMatchObject({ detail: "Provisional" });
  });
});

/** #1170: a Direct delivery never asks for an Item Location or a Transmittal. */
describe("digestIpas: Direct delivery section lines", () => {
  it("says Direct delivery to client instead of the Item Location and Transmittal", () => {
    const { lines } = digestIpas(makePrintableIpas({ row: { direct_delivery: true } }));
    expect(lines.logistics).toBe("Direct delivery to client");
    expect(lines.delivery).toMatch(/^Direct delivery to client/);
    expect(lines.delivery).not.toMatch(/Item Location|Transmittal/);
  });

  it("still asks for them on a normal delivery", () => {
    const { lines } = digestIpas(makePrintableIpas({ row: { direct_delivery: false } }));
    expect(lines.delivery).toMatch(/no Transmittal yet/);
  });
});
