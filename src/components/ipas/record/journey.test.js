import { describe, expect, it } from "vitest";

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
