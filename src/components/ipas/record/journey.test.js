import { describe, expect, it } from "vitest";

import { IPAS_COMPUTATION_STATUS } from "@/constants/ipas";

import { journeyFor } from "./journey";

const digest = (over = {}) => ({
  s1: {}, s3: {}, s6: {}, s7: {}, s8: {},
  docs: { missingByPart: { purchasing: [], finance: [], costing: [], filing: [] } },
  money: {},
  costsComplete: false,
  ...over,
});
const ipasOf = (over = {}) => ({ number: "IPAS-1", source: "local", currency: "PHP", charges: [], payments: [], slips: [], ...over });
const run = ({ ipas = ipasOf(), dig = digest(), can = {} } = {}) =>
  journeyFor({ ipas, digest: dig, lists: {}, userId: "u1", can: { purchasing: false, change: false, record: false, pickLocation: false, ...can } });
const item = (journey, key) => journey.ready.find((entry) => entry.key === key);

describe("journeyFor: Finance (#937)", () => {
  const missingProof = digest({ docs: { missingByPart: { purchasing: ["Proforma Invoice"], finance: ["Proof of payment of Oct 1, 2026"], costing: [], filing: [] } } });
  const foreign = ipasOf({ currency: "USD", payments: [{ forex_rate: null }] });

  it("gives payments, proof and the forex rate to Finance, and the other files to Purchasing", () => {
    const journey = run({ ipas: foreign, dig: missingProof });
    for (const key of ["charges", "proof", "forex"]) expect(item(journey, key).who.names).toBe("Finance");
    expect(item(journey, "files").who.names).not.toBe("Finance");
  });

  it("says Your turn to Finance for proof and the rate, never for the other files", () => {
    const journey = run({ ipas: foreign, dig: missingProof, can: { record: true } });
    expect(item(journey, "proof").action).toBeTruthy();
    expect(item(journey, "forex").action).toBeTruthy();
    expect(item(journey, "files").action).toBeNull();
    expect(journey.mine.map((entry) => entry.key)).not.toContain("files");
    expect(journey.headline).toMatch(/^Your turn: /);
  });

  it("tells Finance who they are waiting on when nothing is theirs", () => {
    const journey = run({
      dig: digest({ docs: { missingByPart: { purchasing: ["Proforma Invoice"], finance: [], costing: [], filing: [] } } }),
      can: { record: true },
    });
    expect(journey.mine).toHaveLength(0);
    expect(journey.headline).toContain("Waiting on");
    expect(journey.headline).toContain("Attach the files");
  });

  it("lets Purchasing attach the other files", () => {
    const journey = run({ dig: missingProof, can: { change: true, record: true } });
    expect(item(journey, "files").action).toMatchObject({ section: "documents" });
  });
});


const baseDigest = {
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
  journeyFor({ ipas: { charges, slips: [], source: "local" }, digest: baseDigest, lists: {}, userId: "u1", can });
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
        ...baseDigest,
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
