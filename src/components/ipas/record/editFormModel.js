// The IPAS long edit form's model (#581): what the form starts from, which
// required fields are still empty, and what one Save has to send. Pure, so the
// page and the tests read the same rules.
//
// The money is typed in place too: payments, charges and documents are lists of
// rows (`form.payments` and so on, each row a draft with a `key`; a row with no
// `id` is new), and the bank details, freight service, spread and computation
// status are plain keys.

import {
  IPAS_OVERRIDE,
  IPAS_PAYMENT_KIND,
  IPAS_STATUS_SOURCE,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
  IPAS_TYPED_STATUS,
  ipasSectionLabel,
} from "@/constants/ipas";
import { getCurrentLocalDate } from "@/utils/formatDate.js";
import { isIsoDate, parseAmountInput } from "@/utils/ipasPayments";
import { isLandedCostFinal } from "@/utils/ipasSignoffs";
import { isPhpCurrency } from "@/utils/landedCost";

/** The sections of the form, in reading order: Header, then 1 to 7 as on the record. */
export const FORM_SECTIONS = [
  {
    key: "header",
    title: "Header",
    hint: "Odoo fills these. Type only to replace Odoo's value.",
  },
  {
    key: "purchasing",
    hint: "Supplier, P.I, freight and the payments made to them.",
  },
  {
    key: "finance",
    hint: "Charges paid in pesos, the documents in hand, and where the money goes.",
  },
  {
    key: "costing",
    hint: "How far the costing is, and how charges spread over the lines.",
  },
  {
    key: "filing",
    hint: "Received, Noted, Checked and Approved are sign-offs, given from Your move.",
  },
  { key: "sales", hint: "What the order is for, and the two planning ticks." },
  { key: "logistics", hint: "Where the goods are kept once they arrive." },
  {
    key: "status",
    hint: "The dates the goods moved. Import only for Supplier Origin.",
  },
].map((section) => ({
  ...section,
  title: section.title ?? ipasSectionLabel(section.key),
}));

const SECTION_ORDER = FORM_SECTIONS.map((section) => section.key);

/** The choice in a new document's picker that means "type its name". */
export const BY_HAND = "__by_hand__";

const OVERRIDE_KEYS = {
  entity: IPAS_OVERRIDE.ENTITY,
  analytic: IPAS_OVERRIDE.ANALYTIC,
  sourceDoc: IPAS_OVERRIDE.SOURCE_DOC,
};

/** Which form keys each section owns, for its changed count. The row lists are counted by `changeCount`. */
export const OWNS = {
  header: ["entity", "remarks"],
  purchasing: ["contact", "piNumber", "piQtAmount", "freight"],
  finance: ["bankName", "accountName", "accountNumber"],
  costing: ["split", "computationStatus"],
  filing: [],
  sales: ["sourceDoc", "analytic", "googleSheet", "ganttChart"],
  logistics: ["location"],
  status: [
    "shippedOut",
    "onboard",
    "arrivedInPh",
    "arrivedInWhs",
    "importClearance",
    "delivered",
    "actualChecking",
  ],
};

const day = (value) => (value ? String(value).slice(0, 10) : "");
const text = (value) =>
  value === null || value === undefined ? "" : String(value);

function actualCheckingItem(ipas) {
  return (
    (ipas.buyerTrack ?? []).find((item) => item.key === "actual_checking") ??
    null
  );
}

/** True when the Actual Checking stamp is Purchasing's to give or clear (not read from Transmittals). */
export function actualCheckingStampable(ipas) {
  const item = actualCheckingItem(ipas);
  return !item || item.source === IPAS_STATUS_SOURCE.STAMPED;
}

// ── Row drafts ──────────────────────────────────────────────────────────────

let draftCounter = 0;
const draftKey = () => `new-${(draftCounter += 1)}`;

export const paymentDraft = (payment) => ({
  key: payment.id,
  id: payment.id,
  kind: payment.kind ?? IPAS_PAYMENT_KIND.PAYMENT,
  paidOn: payment.paid_on ?? "",
  amount: text(payment.amount),
  phpDebited: text(payment.php_debited),
  chargeFeePhp: payment.charge_fee_php ? text(payment.charge_fee_php) : "",
  methodId: payment.method_id ?? "",
  checkNo: payment.check_no ?? "",
  proofUrl: payment.proof_url ?? "",
});

/** A new, empty payment row: today's date and the kind "Payment". */
export const newPaymentDraft = () => ({
  key: draftKey(),
  id: null,
  kind: IPAS_PAYMENT_KIND.PAYMENT,
  paidOn: getCurrentLocalDate(),
  amount: "",
  phpDebited: "",
  chargeFeePhp: "",
  methodId: "",
  checkNo: "",
  proofUrl: "",
});

export const chargeDraft = (charge) => ({
  key: charge.id,
  id: charge.id,
  kindId: charge.kind_id ?? "",
  chargedOn: charge.charged_on ?? "",
  amountPhp: text(charge.amount_php),
});

export const newChargeDraft = () => ({
  key: draftKey(),
  id: null,
  kindId: "",
  chargedOn: getCurrentLocalDate(),
  amountPhp: "",
});

export const documentDraft = (document) => ({
  key: document.id,
  id: document.id,
  purchasingHas: Boolean(document.purchasingHas),
  financeHas: Boolean(document.financeHas),
  attachmentUrl: document.attachmentUrl ?? "",
});

/** A new document row: `choice` is a document kind's id or BY_HAND, `label` the typed name. */
export const newDocumentDraft = (hasKinds = true) => ({
  key: draftKey(),
  id: null,
  choice: hasKinds ? "" : BY_HAND,
  label: "",
});

/** The form's values as the stored IPAS has them. */
export function formFromIpas(ipas) {
  const override = (key) => {
    const state = ipas.overrides?.[key];
    return state?.overridden ? (state.value ?? "") : "";
  };
  const origin = ipas.supplierOrigin ?? {};
  const bank = ipas.bankDetails ?? null;
  const form = {
    entity: override(IPAS_OVERRIDE.ENTITY),
    sourceDoc: override(IPAS_OVERRIDE.SOURCE_DOC),
    analytic: override(IPAS_OVERRIDE.ANALYTIC),
    remarks: ipas.remarks ?? "",
    contact: ipas.contact ?? "",
    piNumber: ipas.piNumber ?? "",
    piQtAmount:
      ipas.piQtAmount === null || ipas.piQtAmount === undefined
        ? ""
        : String(ipas.piQtAmount),
    freight: ipas.freight_service_id ?? "",
    split: ipas.landedCostSplit ?? "value",
    computationStatus: ipas.computationStatus ?? "",
    bankName: bank?.bankName ?? "",
    accountName: bank?.accountName ?? "",
    accountNumber: bank?.accountNumber ?? "",
    googleSheet: Boolean(ipas.googleSheet),
    ganttChart: Boolean(ipas.ganttChart),
    location: ipas.item_location_id ?? "",
    importClearance: day(ipas.import_clearance_on),
    delivered: day(ipas.delivered_on),
    actualChecking: Boolean(actualCheckingItem(ipas)?.ticked),
    // Not typed: whether the PO is in pesos decides which payment boxes are required.
    isPhp: isPhpCurrency(ipas.currency),
    payments: (ipas.payments ?? []).map(paymentDraft),
    charges: (ipas.charges ?? []).map(chargeDraft),
    documents: (ipas.documents ?? []).map(documentDraft),
  };
  for (const { field, column } of IPAS_SUPPLIER_ORIGIN_FIELDS)
    form[field] = day(origin[field] ?? ipas[column]);
  return form;
}

const blank = (value) =>
  value === "" ||
  value === null ||
  value === undefined ||
  String(value).trim() === "";

/** The form keys whose value differs from the stored one. */
export function changedKeys(form, base, section) {
  const keys = section ? OWNS[section] : Object.values(OWNS).flat();
  return keys.filter((key) => form[key] !== base[key]);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The rows of `form[list]` that are new, and those whose values differ from the stored row. */
export function rowChanges(form, base, list) {
  const stored = new Map(base[list].map((row) => [row.id, row]));
  const added = [];
  const updated = [];
  for (const row of form[list]) {
    if (!row.id) added.push(row);
    else if (stored.has(row.id) && !same(row, stored.get(row.id)))
      updated.push(row);
  }
  return { added, updated };
}

/** How many things Save all would send: changed boxes plus new and changed rows. */
export function changeCount(form, base) {
  let n = changedKeys(form, base).length;
  for (const list of ["payments", "charges", "documents"]) {
    const { added, updated } = rowChanges(form, base, list);
    n += added.length + updated.length;
  }
  return n;
}

/**
 * Every required field, in reading order: { section, id (the control's DOM id), label, filled }.
 * The money rows add theirs: what the old payment, charge and document dialogs asked for.
 */
export function requiredFields(form) {
  const out = [];
  const need = (section, id, label, value) =>
    out.push({ section, id, label, filled: !blank(value) });
  need("purchasing", "f-contact", "Supplier's name", form.contact);
  need("purchasing", "f-piNumber", "P.I #", form.piNumber);
  need("purchasing", "f-piQtAmount", "P.I/QT Amount", form.piQtAmount);
  form.payments.forEach((p, i) => {
    const n = `Payment ${i + 1}`;
    need("purchasing", `pay-${p.key}-paidOn`, `${n} date`, p.paidOn);
    need("purchasing", `pay-${p.key}-amount`, `${n} amount`, p.amount);
    // "Pesos taken from the bank" is optional (#604): not a required field.
    need("purchasing", `pay-${p.key}-methodId`, `${n} method`, p.methodId);
  });
  form.charges.forEach((c, i) => {
    const n = `Charge ${i + 1}`;
    need("finance", `chg-${c.key}-kindId`, `${n} kind`, c.kindId);
    need("finance", `chg-${c.key}-chargedOn`, `${n} date`, c.chargedOn);
    need("finance", `chg-${c.key}-amountPhp`, `${n} amount`, c.amountPhp);
  });
  form.documents
    .filter((d) => !d.id)
    .forEach((d, i) => {
      const n = `New document ${i + 1}`;
      need("finance", `doc-${d.key}-choice`, `${n}`, d.choice);
      if (d.choice === BY_HAND)
        need("finance", `doc-${d.key}-label`, `${n} name`, d.label);
    });
  need("logistics", "f-location", "Item Location", form.location);
  return out.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section),
  );
}

/** The required fields still empty. */
export function missingFields(form) {
  return requiredFields(form).filter((field) => !field.filled);
}

/**
 * Whether an optional section (no required fields) has something in it. Costing
 * counts only once Landed Cost is final, Filing never (it holds only sign-offs).
 * The spread default and an unticked box are not values.
 */
function sectionFilled(form, key) {
  if (key === "filing") return false;
  if (key === "costing") return isLandedCostFinal(form.computationStatus);
  const has = (value) => value === true || (typeof value !== "boolean" && !blank(value));
  if (OWNS[key].some((field) => has(form[field]))) return true;
  if (key === "finance") return form.documents.length > 0;
  return false;
}

/** [{ key, title, total, left, done, filled }] for every section; `filled` is for optional ones. */
export function sectionProgress(form) {
  const all = requiredFields(form);
  return FORM_SECTIONS.map((section) => {
    const mine = all.filter((f) => f.section === section.key);
    const left = mine.filter((f) => !f.filled).length;
    return {
      key: section.key,
      title: section.title,
      total: mine.length,
      left,
      done: mine.length - left,
      filled: mine.length === 0 && sectionFilled(form, section.key),
    };
  });
}

// ── What a Save sends ───────────────────────────────────────────────────────

function positive(raw) {
  const parsed = parseAmountInput(raw);
  return parsed.ok && parsed.value !== null && parsed.value > 0;
}

function paymentProblem(p, isPhp) {
  if (!isIsoDate(p.paidOn)) return "Give the date of the payment.";
  if (!positive(p.amount)) return "Amount must be a number more than zero.";
  // Blank is fine (#604); a figure that is given has to be a number above zero.
  if (!isPhp && !blank(p.phpDebited) && !positive(p.phpDebited))
    return "Pesos taken from the bank must be a number more than zero, or left blank.";
  if (!parseAmountInput(p.chargeFeePhp).ok)
    return "Charge fee must be a number.";
  if (!p.methodId) return "Pick the payment method.";
  return null;
}

function chargeProblem(c) {
  if (!c.kindId) return "Pick the kind of charge.";
  if (!isIsoDate(c.chargedOn)) return "Give the date of the charge.";
  if (!positive(c.amountPhp)) return "Amount must be a number more than zero.";
  return null;
}

function documentProblem(d) {
  if (!d.choice) return "Pick the document.";
  if (d.choice === BY_HAND && blank(d.label))
    return "Type the name of the document.";
  return null;
}

const paymentValues = (p) => ({
  kind: p.kind,
  paidOn: p.paidOn,
  amount: p.amount,
  phpDebited: p.phpDebited,
  chargeFeePhp: p.chargeFeePhp,
  methodId: p.methodId,
  checkNo: p.checkNo,
  proofUrl: p.proofUrl,
});

/**
 * What one Save sends, from the changes. `error` is a sentence when something
 * typed can't be saved yet (a half-typed amount, a payment with no method);
 * nothing is sent then. `done` collects the steps already stored, so a Retry
 * of the same plan skips them.
 */
export function planSave(form, base) {
  const plan = {
    overrides: [],
    header: {},
    location: undefined,
    origin: {},
    typed: [],
    stamp: undefined,
    payments: { add: [], update: [], isPhpPo: form.isPhp },
    charges: { add: [], update: [] },
    documents: { add: [], update: [] },
    bank: undefined,
    status: undefined,
    error: null,
    done: new Set(),
  };
  const changed = new Set(changedKeys(form, base));
  const fail = (message) => {
    plan.error ??= message;
  };

  for (const [formKey, field] of Object.entries(OVERRIDE_KEYS)) {
    if (!changed.has(formKey)) continue;
    const value = form[formKey].trim();
    plan.overrides.push(
      value === "" ? { field, reset: true } : { field, value },
    );
  }
  for (const key of [
    "contact",
    "piNumber",
    "piQtAmount",
    "remarks",
    "googleSheet",
    "ganttChart",
  ]) {
    if (!changed.has(key)) continue;
    const target = key === "contact" ? "supplierContact" : key;
    plan.header[target] =
      typeof form[key] === "string" ? form[key].trim() : form[key];
  }
  if (changed.has("freight"))
    plan.header.freightServiceId = form.freight || null;
  if (changed.has("split")) plan.header.landedCostSplit = form.split;
  if (
    changed.has("piQtAmount") &&
    !blank(form.piQtAmount) &&
    !parseAmountInput(form.piQtAmount).ok
  ) {
    fail("P.I/QT Amount must be a number.");
  }
  if (changed.has("location")) plan.location = form.location || null;
  for (const { field } of IPAS_SUPPLIER_ORIGIN_FIELDS)
    if (changed.has(field)) plan.origin[field] = form[field];
  if (changed.has("importClearance"))
    plan.typed.push({
      kind: IPAS_TYPED_STATUS.IMPORT_CLEARANCE,
      date: form.importClearance,
    });
  if (changed.has("delivered"))
    plan.typed.push({
      kind: IPAS_TYPED_STATUS.DELIVERED,
      date: form.delivered,
    });
  if (changed.has("actualChecking")) plan.stamp = form.actualChecking;

  const pay = rowChanges(form, base, "payments");
  for (const [target, rows] of [
    ["add", pay.added],
    ["update", pay.updated],
  ]) {
    for (const row of rows) {
      const problem = paymentProblem(row, form.isPhp);
      if (problem)
        fail(`Payment ${form.payments.indexOf(row) + 1}: ${problem}`);
      plan.payments[target].push({
        key: row.key,
        id: row.id,
        values: paymentValues(row),
      });
    }
  }
  const chg = rowChanges(form, base, "charges");
  for (const [target, rows] of [
    ["add", chg.added],
    ["update", chg.updated],
  ]) {
    for (const row of rows) {
      const problem = chargeProblem(row);
      if (problem) fail(`Charge ${form.charges.indexOf(row) + 1}: ${problem}`);
      plan.charges[target].push({
        key: row.key,
        id: row.id,
        values: {
          kindId: row.kindId,
          chargedOn: row.chargedOn,
          amountPhp: row.amountPhp,
        },
      });
    }
  }
  const docs = rowChanges(form, base, "documents");
  for (const row of docs.added) {
    const problem = documentProblem(row);
    if (problem)
      fail(`New document ${docs.added.indexOf(row) + 1}: ${problem}`);
    plan.documents.add.push({
      key: row.key,
      choice:
        row.choice === BY_HAND ? { label: row.label } : { kindId: row.choice },
    });
  }
  for (const row of docs.updated) {
    const before = base.documents.find((d) => d.id === row.id);
    const item = { key: row.key, id: row.id };
    if (row.purchasingHas !== before.purchasingHas)
      item.purchasing = row.purchasingHas;
    if (row.financeHas !== before.financeHas) item.finance = row.financeHas;
    if (row.attachmentUrl !== before.attachmentUrl)
      item.attachmentUrl = row.attachmentUrl;
    plan.documents.update.push(item);
  }

  if (
    ["bankName", "accountName", "accountNumber"].some((key) => changed.has(key))
  ) {
    plan.bank = {
      bankName: form.bankName,
      accountName: form.accountName,
      accountNumber: form.accountNumber,
    };
  }
  if (changed.has("computationStatus")) plan.status = form.computationStatus;
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
    plan.stamp === undefined &&
    plan.payments.add.length + plan.payments.update.length === 0 &&
    plan.charges.add.length + plan.charges.update.length === 0 &&
    plan.documents.add.length + plan.documents.update.length === 0 &&
    plan.bank === undefined &&
    plan.status === undefined
  );
}
