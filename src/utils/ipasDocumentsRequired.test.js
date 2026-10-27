import { describe, expect, it } from "vitest";

import { missingDocumentsByPart } from "./ipasDocuments";

const doc = (label, attachmentUrl = "https://x/f.pdf") => ({ byHand: false, kind: { label }, attachmentUrl });

describe("missingDocumentsByPart", () => {
  it("asks an Import IPAS for every paper of its parts", () => {
    const missing = missingDocumentsByPart([], [], "import");
    expect(missing.purchasing).toEqual(["Proforma Invoice"]);
    expect(missing.costing).toHaveLength(4);
    expect(missing.filing).toEqual(["BIR 2307"]);
  });

  it("does not ask a Local IPAS for the Import-only papers", () => {
    const missing = missingDocumentsByPart([], [], "local");
    expect(missing.purchasing).toEqual(["Quotation (Local)"]);
    expect(missing.costing).toEqual([]);
  });

  it("counts a document only when it has a file", () => {
    expect(missingDocumentsByPart([doc("Proforma Invoice")], [], "import").purchasing).toEqual([]);
    expect(missingDocumentsByPart([doc("Proforma Invoice", null)], [], "import").purchasing).toEqual(["Proforma Invoice"]);
  });

  it("asks for proof on every payment without one", () => {
    const payments = [
      { paid_on: "2026-10-14", proof_url: "https://x/p.png" },
      { paid_on: "2026-10-20", proof_url: null },
    ];
    expect(missingDocumentsByPart([], payments, "import").finance).toEqual(["Proof of payment of Oct 20, 2026"]);
  });
});
