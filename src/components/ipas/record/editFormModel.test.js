import { describe, expect, it } from "vitest";

import {
  BY_HAND,
  changeCount,
  changedKeys,
  formFromIpas,
  missingFields,
  newChargeDraft,
  newDocumentDraft,
  newPaymentDraft,
  planIsEmpty,
  planSave,
  sectionProgress,
} from "./editFormModel";

const ipas = (over = {}) => ({
  overrides: {
    entity: { overridden: false, value: "T3ck Trading", odoo: "T3ck Trading" },
    source_doc: { overridden: false, value: null, odoo: null },
    analytic: { overridden: true, value: "A-1", odoo: "A-0" },
  },
  remarks: "",
  contact: "",
  piNumber: "",
  piQtAmount: null,
  googleSheet: false,
  ganttChart: false,
  item_location_id: null,
  supplierOrigin: null,
  buyerTrack: [],
  currency: "PHP",
  payments: [],
  charges: [],
  documents: [],
  bankDetails: null,
  freight_service_id: null,
  landedCostSplit: "value",
  computationStatus: "encoding",
  ...over,
});

describe("IPAS edit form model", () => {
  it("starts from the stored values, with an override box blank until it is overridden", () => {
    const form = formFromIpas(ipas({ contact: "R. Cruz", piQtAmount: 8400 }));
    expect(form).toMatchObject({ entity: "", analytic: "A-1", contact: "R. Cruz", piQtAmount: "8400" });
  });

  it("lists the required boxes still empty and counts them per section", () => {
    const form = formFromIpas(ipas({ contact: "R. Cruz" }));
    expect(missingFields(form).map((m) => m.id)).toEqual(["f-piNumber", "f-piQtAmount", "f-location"]);
    const progress = sectionProgress(form);
    expect(progress.find((p) => p.key === "order")).toMatchObject({ total: 3, left: 2, done: 1 });
    expect(progress.find((p) => p.key === "delivery")).toMatchObject({ total: 1, left: 1 });
    expect(progress.find((p) => p.key === "payments")).toMatchObject({ total: 0 });
  });

  it("sends only what changed: a reset for a cleared override, the header fields together", () => {
    const base = formFromIpas(ipas());
    const form = { ...base, analytic: "", entity: "TG", contact: " R. Cruz ", googleSheet: true, location: "opt-1" };
    expect(changedKeys(form, base)).toEqual(expect.arrayContaining(["analytic", "entity", "contact", "googleSheet", "location"]));
    const plan = planSave(form, base);
    expect(plan.overrides).toEqual(expect.arrayContaining([{ field: "analytic", reset: true }, { field: "entity", value: "TG" }]));
    expect(plan.header).toEqual({ supplierContact: "R. Cruz", googleSheet: true });
    expect(plan.location).toBe("opt-1");
    expect(plan.error).toBeNull();
    expect(planIsEmpty(plan)).toBe(false);
  });

  it("is empty when nothing changed and refuses a half-typed amount with a sentence", () => {
    const base = formFromIpas(ipas());
    expect(planIsEmpty(planSave(base, base))).toBe(true);
    expect(planSave({ ...base, piQtAmount: "12k" }, base).error).toBe("P.I/QT Amount must be a number.");
  });

  describe("the money, typed in place", () => {
    const saved = {
      id: "pay-1",
      kind: "payment",
      paid_on: "2026-10-01",
      amount: 8325,
      php_debited: null,
      charge_fee_php: 0,
      method_id: "m-1",
      check_no: null,
      proof_url: null,
    };

    it("starts from the stored payments, charges, documents, bank details, freight and spread", () => {
      const form = formFromIpas(
        ipas({
          payments: [saved],
          charges: [{ id: "c-1", kind_id: "k-1", charged_on: "2026-10-02", amount_php: 300 }],
          documents: [{ id: "d-1", purchasingHas: true, financeHas: false, attachmentUrl: null }],
          bankDetails: { bankName: "BDO", accountName: "Scorpe", accountNumber: "0012" },
          freight_service_id: "f-1",
          landedCostSplit: "quantity",
        }),
      );
      expect(form.payments).toEqual([expect.objectContaining({ id: "pay-1", amount: "8325", methodId: "m-1", forexRate: "" })]);
      expect(form.charges[0]).toMatchObject({ kindId: "k-1", amountPhp: "300" });
      expect(form.documents[0]).toMatchObject({ purchasingHas: true, attachmentUrl: "" });
      expect(form).toMatchObject({ bankName: "BDO", freight: "f-1", split: "quantity", computationStatus: "encoding" });
    });

    it("counts the boxes the old dialogs required: a payment's date, amount and method, a charge's kind, date and amount", () => {
      const base = formFromIpas(ipas({ contact: "R. Cruz", piNumber: "PI-1", piQtAmount: 1 }));
      const payment = newPaymentDraft();
      const charge = newChargeDraft();
      const form = { ...base, payments: [payment], charges: [charge] };
      expect(missingFields(form).map((m) => m.id)).toEqual([
        `pay-${payment.key}-amount`,
        `pay-${payment.key}-methodId`,
        `chg-${charge.key}-kindId`,
        `chg-${charge.key}-amountPhp`,
        "f-location",
      ]);
      const progress = sectionProgress(form);
      expect(progress.find((p) => p.key === "order")).toMatchObject({ total: 3, left: 0 });
      expect(progress.find((p) => p.key === "payments")).toMatchObject({ total: 3, left: 2 });
      expect(progress.find((p) => p.key === "costs")).toMatchObject({ total: 3, left: 2 });
      expect(progress.find((p) => p.key === "delivery")).toMatchObject({ total: 1, left: 1 });
    });

    it("never asks for the forex rate: it is optional on a foreign-currency PO (#604)", () => {
      const payment = newPaymentDraft();
      const php = { ...formFromIpas(ipas()), payments: [payment] };
      const usd = { ...formFromIpas(ipas({ currency: "USD" })), payments: [payment] };
      expect(missingFields(php).map((m) => m.id)).not.toContain(`pay-${payment.key}-forexRate`);
      expect(missingFields(usd).map((m) => m.id)).not.toContain(`pay-${payment.key}-forexRate`);
    });

    it("needs a new document's pick, and its name when typed by hand", () => {
      const base = formFromIpas(ipas());
      const doc = newDocumentDraft(true);
      expect(missingFields({ ...base, documents: [doc] }).map((m) => m.label)).toContain("New document 1");
      const byHand = { ...doc, choice: BY_HAND };
      expect(missingFields({ ...base, documents: [byHand] }).map((m) => m.label)).toContain("New document 1 name");
    });

    it("plans new and changed rows apart, and the rest of the money after the header", () => {
      const base = formFromIpas(ipas({ payments: [saved], documents: [{ id: "d-1", purchasingHas: false, financeHas: false, attachmentUrl: null }] }));
      const added = { ...newPaymentDraft(), amount: "100", methodId: "m-1" };
      const form = {
        ...base,
        freight: "f-9",
        split: "equal",
        computationStatus: "encoded",
        bankName: "BPI",
        payments: [{ ...base.payments[0], amount: "8000" }, added],
        documents: [{ ...base.documents[0], purchasingHas: true, attachmentUrl: "https://x/y.pdf" }, { ...newDocumentDraft(), choice: "kind-1" }],
      };
      expect(changeCount(form, base)).toBe(8);
      const plan = planSave(form, base);
      expect(plan.error).toBeNull();
      expect(plan.header).toEqual({ freightServiceId: "f-9", landedCostSplit: "equal" });
      expect(plan.payments.update).toEqual([expect.objectContaining({ id: "pay-1", values: expect.objectContaining({ amount: "8000" }) })]);
      expect(plan.payments.add).toEqual([expect.objectContaining({ key: added.key })]);
      expect(plan.documents.update).toEqual([{ key: "d-1", id: "d-1", purchasing: true, attachmentUrl: "https://x/y.pdf" }]);
      expect(plan.documents.add).toEqual([expect.objectContaining({ choice: { kindId: "kind-1" } })]);
      expect(plan.bank).toEqual({ bankName: "BPI", accountName: "", accountNumber: "" });
      expect(plan.status).toBe("encoded");
      expect(planIsEmpty(plan)).toBe(false);
    });

    it("sends nothing and says why when a payment can't be saved yet", () => {
      const base = formFromIpas(ipas());
      const bad = { ...newPaymentDraft(), amount: "12abc", methodId: "m-1" };
      expect(planSave({ ...base, payments: [bad] }, base).error).toBe("Payment 1: Amount must be a number more than zero.");
      const noMethod = { ...newPaymentDraft(), amount: "5" };
      expect(planSave({ ...base, payments: [noMethod] }, base).error).toBe("Payment 1: Pick the payment method.");
      const foreign = formFromIpas(ipas({ currency: "USD" }));
      // Pesos taken from the bank may be left blank on a foreign PO (#604); a given figure must be above zero.
      const noPhp = { ...newPaymentDraft(), amount: "5", methodId: "m-1" };
      expect(planSave({ ...foreign, payments: [noPhp] }, foreign).error).toBeNull();
      const zeroPhp = { ...noPhp, forexRate: "0" };
      expect(planSave({ ...foreign, payments: [zeroPhp] }, foreign).error).toBe(
        "Payment 1: Forex rate paid must be a number more than zero, or left blank.",
      );
      expect(planSave({ ...base, charges: [newChargeDraft()] }, base).error).toBe("Charge 1: Pick the kind of charge.");
    });

    it("section 2 is not complete when a charge has a blank amount", () => {
      const form = formFromIpas(
        ipas({
          charges: [{ id: "c-1", kind_id: "k-1", charged_on: "2026-10-02", amount_php: null }],
        }),
      );
      const progress = sectionProgress(form);
      const finance = progress.find((p) => p.key === "costs");
      expect(finance.complete).toBe(false);
      expect(finance.left).toBeGreaterThan(0);
    });

    it("section 2 is complete when all required fields and charges have amounts", () => {
      const form = formFromIpas(
        ipas({
          charges: [{ id: "c-1", kind_id: "k-1", charged_on: "2026-10-02", amount_php: 500 }],
        }),
      );
      const progress = sectionProgress(form);
      const finance = progress.find((p) => p.key === "costs");
      expect(finance.complete).toBe(true);
      expect(finance.left).toBe(0);
    });
  });
});

describe("the stepper's Filled state", () => {
  const filledOf = (form, key) => sectionProgress(form).find((p) => p.key === key).filled;

  it("never marks Order filled: it has required fields", () => {
    const form = formFromIpas(ipas());
    expect(filledOf(form, "order")).toBe(false);
    expect(filledOf({ ...form, remarks: "Rush" }, "order")).toBe(false);
  });

  it("never marks Delivery filled: the Item Location is a required field there", () => {
    const form = formFromIpas(ipas({ item_location_id: "opt-1" }));
    expect(filledOf({ ...form, delivered: "2026-10-01" }, "delivery")).toBe(false);
    expect(filledOf({ ...form, actualChecking: true }, "delivery")).toBe(false);
  });

  it("marks Documents filled once one is listed, and Payments not while empty", () => {
    const form = formFromIpas(ipas());
    expect(filledOf(form, "payments")).toBe(false);
    expect(filledOf(form, "documents")).toBe(false);
    expect(filledOf({ ...form, documents: [{ ...newDocumentDraft(), id: "d1" }] }, "documents")).toBe(true);
  });

  it("never marks a section with required fields", () => {
    const form = formFromIpas(ipas({ contact: "R. Cruz", piNumber: "PI-1", piQtAmount: 10, item_location_id: "opt-1" }));
    expect(filledOf({ ...form, remarks: "x" }, "order")).toBe(false);
  });

  it("marks Costs only once Landed Cost is final", () => {
    const form = formFromIpas(ipas());
    expect(filledOf({ ...form, computationStatus: "encoded" }, "costs")).toBe(false);
    expect(filledOf({ ...form, computationStatus: "lc_odoo_done" }, "costs")).toBe(true);
  });
});
