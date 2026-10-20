// The IPAS long edit form's model (#581): what the form starts from, which
// required fields are still empty, and what one Save has to send. Pure, so the
// page and the tests read the same rules.

import { IPAS_OVERRIDE, IPAS_STATUS_SOURCE, IPAS_SUPPLIER_ORIGIN_FIELDS, IPAS_TYPED_STATUS, ipasSectionLabel } from "@/constants/ipas";
import { parseAmountInput } from "@/utils/ipasPayments";

/** The sections of the form, in reading order: Header, then 1 to 7 as on the record. */
export const FORM_SECTIONS = [
  { key: "header", title: "Header", hint: "Odoo fills these. Type only to replace Odoo's value." },
  { key: "purchasing", hint: "Supplier, P.I and the payments made to them." },
  { key: "finance", hint: "Charges paid in pesos, the documents in hand, and where the money goes." },
  { key: "costing", hint: "How far the costing is, and how charges spread over the lines." },
  { key: "filing", hint: "Received, Noted, Checked and Approved are sign-offs, given from Your move." },
  { key: "sales", hint: "What the order is for, and the two planning ticks." },
  { key: "logistics", hint: "Where the goods are kept once they arrive." },
  { key: "status", hint: "The dates the goods moved. Import only for Supplier Origin." },
].map((section) => ({ ...section, title: section.title ?? ipasSectionLabel(section.key) }));

/** The sections whose money and sign-offs keep their own controls (dialogs, buttons) inside the form. */
export const EMBEDDED_SECTIONS = ["finance", "costing", "filing"];

const OVERRIDE_KEYS = {
  entity: IPAS_OVERRIDE.ENTITY,
  analytic: IPAS_OVERRIDE.ANALYTIC,
  sourceDoc: IPAS_OVERRIDE.SOURCE_DOC,
};

/** Which form keys each section owns, for its changed count. */
export const OWNS = {
  header: ["entity", "remarks"],
  purchasing: ["contact", "piNumber", "piQtAmount"],
  finance: [],
  costing: [],
  filing: [],
  sales: ["sourceDoc", "analytic", "googleSheet", "ganttChart"],
  logistics: ["location"],
  status: ["shippedOut", "onboard", "arrivedInPh", "arrivedInWhs", "importClearance", "delivered", "actualChecking"],
};

const day = (value) => (value ? String(value).slice(0, 10) : "");

function actualCheckingItem(ipas) {
  return (ipas.buyerTrack ?? []).find((item) => item.key === "actual_checking") ?? null;
}

/** True when the Actual Checking stamp is Purchasing's to give or clear (not read from Transmittals). */
export function actualCheckingStampable(ipas) {
  const item = actualCheckingItem(ipas);
  return !item || item.source === IPAS_STATUS_SOURCE.STAMPED;
}

/** The form's values as the stored IPAS has them. */
export function formFromIpas(ipas) {
  const override = (key) => {
    const state = ipas.overrides?.[key];
    return state?.overridden ? (state.value ?? "") : "";
  };
  const origin = ipas.supplierOrigin ?? {};
  const form = {
    entity: override(IPAS_OVERRIDE.ENTITY),
    sourceDoc: override(IPAS_OVERRIDE.SOURCE_DOC),
    analytic: override(IPAS_OVERRIDE.ANALYTIC),
    remarks: ipas.remarks ?? "",
    contact: ipas.contact ?? "",
    piNumber: ipas.piNumber ?? "",
    piQtAmount: ipas.piQtAmount === null || ipas.piQtAmount === undefined ? "" : String(ipas.piQtAmount),
    googleSheet: Boolean(ipas.googleSheet),
    ganttChart: Boolean(ipas.ganttChart),
    location: ipas.item_location_id ?? "",
    importClearance: day(ipas.import_clearance_on),
    delivered: day(ipas.delivered_on),
    actualChecking: Boolean(actualCheckingItem(ipas)?.ticked),
  };
  for (const { field, column } of IPAS_SUPPLIER_ORIGIN_FIELDS) form[field] = day(origin[field] ?? ipas[column]);
  return form;
}

const blank = (value) => value === "" || value === null || value === undefined || String(value).trim() === "";

/** The form keys whose value differs from the stored one. */
export function changedKeys(form, base, section) {
  const keys = section ? OWNS[section] : Object.values(OWNS).flat();
  return keys.filter((key) => form[key] !== base[key]);
}

/** Every required field still empty, in reading order: { section, id (the control's DOM id), label }. */
export function missingFields(form) {
  const out = [];
  const need = (section, id, label, value) => blank(value) && out.push({ section, id, label });
  need("purchasing", "f-contact", "Supplier's name", form.contact);
  need("purchasing", "f-piNumber", "P.I #", form.piNumber);
  need("purchasing", "f-piQtAmount", "P.I/QT Amount", form.piQtAmount);
  need("logistics", "f-location", "Item Location", form.location);
  return out;
}

const REQUIRED_TOTAL = { purchasing: 3, logistics: 1 };

/** [{ key, title, total, left, done }] for every section. */
export function sectionProgress(form) {
  const missing = missingFields(form);
  return FORM_SECTIONS.map((section) => {
    const total = REQUIRED_TOTAL[section.key] ?? 0;
    const left = missing.filter((m) => m.section === section.key).length;
    return { key: section.key, title: section.title, total, left, done: total - left };
  });
}

/**
 * What one Save sends, from the changes. `error` is a sentence when something
 * typed can't be saved yet (a half-typed amount); nothing is sent then.
 */
export function planSave(form, base) {
  const plan = { overrides: [], header: {}, location: undefined, origin: {}, typed: [], stamp: undefined, error: null };
  const changed = new Set(changedKeys(form, base));

  for (const [formKey, field] of Object.entries(OVERRIDE_KEYS)) {
    if (!changed.has(formKey)) continue;
    const value = form[formKey].trim();
    plan.overrides.push(value === "" ? { field, reset: true } : { field, value });
  }
  for (const key of ["contact", "piNumber", "piQtAmount", "remarks", "googleSheet", "ganttChart"]) {
    if (!changed.has(key)) continue;
    const target = key === "contact" ? "supplierContact" : key;
    plan.header[target] = typeof form[key] === "string" ? form[key].trim() : form[key];
  }
  if (changed.has("piQtAmount") && !blank(form.piQtAmount) && !parseAmountInput(form.piQtAmount).ok) {
    plan.error = "P.I/QT Amount must be a number.";
  }
  if (changed.has("location")) plan.location = form.location || null;
  if (changed.has("location")) plan.location = form.location || null;
  for (const { field } of IPAS_SUPPLIER_ORIGIN_FIELDS) if (changed.has(field)) plan.origin[field] = form[field];
  if (changed.has("importClearance")) plan.typed.push({ kind: IPAS_TYPED_STATUS.IMPORT_CLEARANCE, date: form.importClearance });
  if (changed.has("delivered")) plan.typed.push({ kind: IPAS_TYPED_STATUS.DELIVERED, date: form.delivered });
  if (changed.has("actualChecking")) plan.stamp = form.actualChecking;
  return plan;
}

/** True when the plan has nothing to send. */
export function planIsEmpty(plan) {
  return (
    plan.overrides.length === 0 &&
    Object.keys(plan.header).length === 0 &&
    plan.location === undefined &&
    Object.keys(plan.origin).length === 0 &&
    plan.typed.length === 0 &&
    plan.stamp === undefined
  );
}
