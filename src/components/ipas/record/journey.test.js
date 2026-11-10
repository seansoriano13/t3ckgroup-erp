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

describe("rail: Approve and file after the Check (#921)", () => {
  const person = (id, name) => ({ employeeId: id, name });
  const signed = (id) => ({ signedBy: { id, name: id } });
  const file = (userId, checkerId) =>
    journeyFor({
      ipas: { charges: [], slips: [{ number: "T1" }], itemLocation: { label: "A" }, source: "local" },
      digest: {
        ...digest,
        costsComplete: true,
        docs: { missingByPart: {} },
        s1: { approved: {} },
        s3: { approved: {} },
        s6: { approved: {} },
        s8: { approved: {} },
        s7: { received: signed(checkerId), noted: signed(checkerId), checked: signed(checkerId) },
      },
      lists: { s7_approved: [person("u1", "Ana"), person("u2", "Ben"), person("u3", "Cy")] },
      userId,
      can: {},
    }).sign.find((item) => item.key === "file");

  it("hides the button from the person who checked and names the others", () => {
    const item = file("u1", "u1");

    expect(item.action).toBeNull();
    expect(item.line).toContain("Checked by you, so someone else on the list files it.");
    expect(item.line).toContain("Ben and Cy");
    expect(item.line).not.toContain("Ana");
  });

  it("still offers the button to another filing approver", () => {
    expect(file("u2", "u1").action).toMatchObject({ kind: "file" });
  });
});

describe("rail: Sign Logistics reads the form first (#925)", () => {
  const logistics = (listed) =>
    journeyFor({
      ipas: { charges: [], slips: [{ number: "T1" }], itemLocation: { label: "A" }, source: "local" },
      digest,
      lists: listed ? { logistics_signed: [{ employeeId: "u1", name: "Lo" }] } : {},
      userId: "u1",
      can: { change: false, record: false },
    }).ready.find((item) => item.key === "logistics");

  it("carries the review window's button and sentence, not a one-click sign", () => {
    expect(logistics(true).action).toMatchObject({ kind: "logistics", confirm: "Sign Logistics" });
    expect(logistics(true).action.what).toBeTruthy();
  });

  it("offers it to nobody off the Logistics list", () => {
    expect(logistics(false).action).toBeNull();
  });
});
