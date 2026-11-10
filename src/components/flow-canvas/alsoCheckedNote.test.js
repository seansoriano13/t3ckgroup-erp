import { describe, it, expect } from "vitest";
import { alsoCheckedNote } from "./flowStageKinds";

const stages = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

describe("alsoCheckedNote", () => {
  it("is null when the kind sits on one Stage only", () => {
    const by = { a: [{ kind: "purchasing_settled" }], b: [{ kind: "tickbox" }] };
    expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBeNull();
  });

  it("names every other Stage that has the kind", () => {
    const by = { a: [{ kind: "x" }], b: [{ kind: "x" }], c: [{ kind: "x" }] };
    expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBe("Also checked at Stages Beta, Gamma");
    expect(alsoCheckedNote(by.b[0], "b", { a: by.a, b: by.b }, stages)).toBe("Also checked at Stage Alpha");
  });

  describe("attachment conditions (#895)", () => {
    const att = (label, config) => ({ kind: "attachment", label, config });

    it("does not flag two different documents that share the attachment kind", () => {
      const by = {
        a: [att("ITB", { documentType: "itb" })],
        b: [att("NOA", { documentType: "noa" })],
        c: [att("Contract", { accepts: ["contract_pdf"] })],
      };
      expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBeNull();
      expect(alsoCheckedNote(by.b[0], "b", by, stages)).toBeNull();
      expect(alsoCheckedNote(by.c[0], "c", by, stages)).toBeNull();
    });

    it("does not flag two 'Any' attachments with different labels", () => {
      const by = { a: [att("Proposal", {})], b: [att("Price list", { accepts: [] })] };
      expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBeNull();
    });

    it("still flags the same document required at two Stages", () => {
      const by = {
        a: [att("PO", { documentType: "po" })],
        b: [att("PO", { documentType: "po" })],
      };
      expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBe("Also checked at Stage Beta");
    });

    it("compares accepts regardless of order and label case", () => {
      const by = {
        a: [att("Contract", { accepts: ["pdf", "docx"] })],
        b: [att("contract ", { accepts: ["docx", "pdf"] })],
      };
      expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBe("Also checked at Stage Beta");
    });

    it("keeps kind-only comparison for non-attachment checks", () => {
      const by = {
        a: [{ kind: "costing_priced", label: "Costing priced", config: {} }],
        b: [{ kind: "costing_priced", label: "Priced again", config: {} }],
      };
      expect(alsoCheckedNote(by.a[0], "a", by, stages)).toBe("Also checked at Stage Beta");
    });
  });
});
