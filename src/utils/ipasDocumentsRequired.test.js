import { describe, expect, it } from "vitest";

import { chargesLackingFile, fileRulesOf, missingDocumentsByPart, requiredFilesByPart, requiredKindsByPart } from "./ipasDocuments";

// The migration's seeded rules (#959): today's, with BIR 2307 not required.
const kind = (id, label, applies_to, required_before = null, over = {}) => ({
  id,
  list: "document_kind",
  label,
  applies_to,
  used_for: "documentation",
  required_before,
  active: true,
  sort: Number(id.replace("k", "")) * 10,
  ...over,
});
const OPTIONS = [
  kind("k1", "Proforma Invoice", "import", 1),
  kind("k2", "Quotation (Local)", "local", 1),
  kind("k3", "Sales Contract", "both"),
  kind("k4", "BL or Waybill", "import", 3),
  kind("k5", "Packing List", "import", 3),
  kind("k6", "Commercial Invoice", "import", 3),
  kind("k7", "BIR 2307", "both"),
  kind("k8", "Freight Billing", "import", 3),
];
const rules = (over = {}) => ({ options: OPTIONS, proofOnEveryPayment: true, fileOnEveryCharge: true, ...over });
const withKind = (label, over) => OPTIONS.map((o) => (o.label === label ? { ...o, ...over } : o));

const doc = (kindId, attachmentUrl = "https://x/f.pdf") => ({ byHand: false, kind_id: kindId, attachmentUrl });

describe("missingDocumentsByPart (built from the settings)", () => {
  it("asks an Import IPAS for the kinds set required, and not BIR 2307", () => {
    const missing = missingDocumentsByPart([], [], "import", rules());
    expect(missing.purchasing).toEqual(["Proforma Invoice"]);
    expect(missing.costing).toEqual(["BL or Waybill", "Packing List", "Commercial Invoice", "Freight Billing"]);
    expect(missing.filing).toEqual([]);
  });

  it("does not ask a Local IPAS for the Import-only papers", () => {
    const missing = missingDocumentsByPart([], [], "local", rules());
    expect(missing.purchasing).toEqual(["Quotation (Local)"]);
    expect(missing.costing).toEqual([]);
  });

  it("asks for a kind once it is set required before 6 Sign-offs, for both Sources", () => {
    const options = withKind("BIR 2307", { required_before: 6 });
    expect(missingDocumentsByPart([], [], "import", rules({ options })).filing).toEqual(["BIR 2307"]);
    expect(missingDocumentsByPart([], [], "local", rules({ options })).filing).toEqual(["BIR 2307"]);
  });

  it("stops asking for a kind set to not required, or deactivated", () => {
    expect(missingDocumentsByPart([], [], "import", rules({ options: withKind("Proforma Invoice", { required_before: null }) })).purchasing).toEqual([]);
    expect(missingDocumentsByPart([], [], "import", rules({ options: withKind("Proforma Invoice", { active: false }) })).purchasing).toEqual([]);
  });

  it("moves a kind to the part it is required before", () => {
    const missing = missingDocumentsByPart([], [], "import", rules({ options: withKind("Packing List", { required_before: 1 }) }));
    expect(missing.purchasing).toEqual(["Proforma Invoice", "Packing List"]);
    expect(missing.costing).not.toContain("Packing List");
  });

  it("counts a document only when it has a file", () => {
    expect(missingDocumentsByPart([doc("k1")], [], "import", rules()).purchasing).toEqual([]);
    expect(missingDocumentsByPart([doc("k1", null)], [], "import", rules()).purchasing).toEqual(["Proforma Invoice"]);
  });

  it("asks for proof on every payment without one, only while that switch is on", () => {
    const payments = [
      { paid_on: "2026-10-14", proof_url: "https://x/p.png" },
      { paid_on: "2026-10-20", proof_url: null },
    ];
    expect(missingDocumentsByPart([], payments, "import", rules()).finance).toEqual(["Proof of payment of Oct 20, 2026"]);
    expect(missingDocumentsByPart([], payments, "import", rules({ proofOnEveryPayment: false })).finance).toEqual([]);
  });
});

describe("requiredFilesByPart", () => {
  it("lists each required kind, flags the ones without a file, and leaves out the ones no longer required", () => {
    const rows = requiredFilesByPart([doc("k1"), doc("k5", null)], [], "import", rules());
    expect(rows.find((r) => r.label === "Proforma Invoice")).toMatchObject({ part: "purchasing", missing: false });
    expect(rows.find((r) => r.label === "Packing List")).toMatchObject({ part: "costing", missing: true });
    expect(rows.find((r) => r.label === "BIR 2307")).toBeUndefined();
  });
});

describe("requiredKindsByPart and fileRulesOf", () => {
  it("reads the options and the switches off an IPAS, switches on when the row is missing", () => {
    expect(fileRulesOf({ options: OPTIONS })).toMatchObject({ proofOnEveryPayment: true, fileOnEveryCharge: true });
    expect(fileRulesOf({ options: OPTIONS, fileRules: { proof_on_every_payment: false, file_on_every_charge: false } })).toMatchObject({
      proofOnEveryPayment: false,
      fileOnEveryCharge: false,
    });
    expect(requiredKindsByPart(fileRulesOf({}), "import")).toEqual({ purchasing: [], costing: [], filing: [] });
  });
});

describe("chargesLackingFile", () => {
  const ipas = (fileRules) => ({ fileRules, charges: [{ id: 1, amount_php: 10, attachment_url: null }, { id: 2, amount_php: null, attachment_url: null }] });
  it("flags a charge with an amount and no file while the switch is on", () => {
    expect(chargesLackingFile(ipas({ file_on_every_charge: true })).map((c) => c.id)).toEqual([1]);
  });
  it("flags nothing while the switch is off", () => {
    expect(chargesLackingFile(ipas({ file_on_every_charge: false }))).toEqual([]);
  });
});
