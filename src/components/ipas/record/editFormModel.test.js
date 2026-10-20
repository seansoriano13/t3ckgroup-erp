import { describe, expect, it } from "vitest";

import { changedKeys, formFromIpas, missingFields, planIsEmpty, planSave, sectionProgress } from "./editFormModel";

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
    expect(progress.find((p) => p.key === "purchasing")).toMatchObject({ total: 3, left: 2, done: 1 });
    expect(progress.find((p) => p.key === "logistics")).toMatchObject({ total: 1, left: 1 });
    expect(progress.find((p) => p.key === "finance")).toMatchObject({ total: 0 });
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
});
