import { describe, expect, it } from "vitest";
import { orderProgress, paymentsProgress } from "./sectionRules";
import { sectionState } from "./digest";
import { missingDocumentsByPart } from "@/utils/ipasDocuments";

describe("orderProgress", () => {
  it("is done with name, P.I # and amount", () => {
    expect(orderProgress({ contact: "Acme", piNumber: "PI-1", piQtAmount: 0 }).done).toBe(true);
  });
  it("names what is missing", () => {
    const r = orderProgress({ contact: " ", piNumber: "PI-1", piQtAmount: null });
    expect(r.done).toBe(false);
    expect(r.detail).toBe("Needs Supplier's name, P.I/QT Amount");
  });
});

describe("paymentsProgress", () => {
  const pay = (o) => ({ paid_on: "2026-01-02", proof_url: "x", rate: 56, ...o });
  it("waits with no payments", () => {
    expect(paymentsProgress({ currency: "USD", payments: [] })).toMatchObject({ done: false, detail: "No payments yet" });
  });
  it("counts proofs", () => {
    const r = paymentsProgress({ currency: "PHP", payments: [pay({}), pay({ proof_url: null })] });
    expect(r).toMatchObject({ done: false, detail: "1 of 2 with proof" });
  });
  it("needs a rate on a foreign PO only", () => {
    const rows = [pay({ rate: null })];
    expect(paymentsProgress({ currency: "USD", payments: rows }).done).toBe(false);
    expect(paymentsProgress({ currency: "PHP", payments: rows }).done).toBe(true);
  });
  it("agrees with the rail's proof rule", () => {
    const payments = [pay({}), pay({ proof_url: null })];
    const lacking = missingDocumentsByPart([], payments, "local").finance.length;
    expect(paymentsProgress({ currency: "PHP", payments }).withProof).toBe(payments.length - lacking);
  });
  it("feeds the section rows", () => {
    const digest = { order: orderProgress({ contact: "A", piNumber: "1", piQtAmount: 1 }), paymentsProgress: paymentsProgress({ currency: "PHP", payments: [pay({})] }) };
    expect(sectionState("order", digest).state).toBe("done");
    expect(sectionState("payments", digest)).toEqual({ state: "done", detail: "Complete" });
  });
});
