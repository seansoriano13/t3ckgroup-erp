// The IPAS long edit form's model (#581): what the form starts from, which
// required fields are still empty, and what one Save has to send. Pure, so the
// page and the tests read the same rules.
//
// The money is typed in place too: payments, charges and documents are lists of
// rows (`form.payments` and so on, each row a draft with a `key`; a row with no
// `id` is new), and the bank details, freight service, spread and computation
// status are plain keys.

import {
  IPAS_ASK_DEFAULT_PRIORITY,
  IPAS_OVERRIDE,
  IPAS_PAYMENT_KIND,
  IPAS_STATUS_SOURCE,
  ipasSectionLabel,
} from "@/constants/ipas";
import { getCurrentLocalDate } from "@/utils/formatDate.js";
import { isIsoDate, isOthersMethod, paymentProofFiles, parseAmountInput } from "@/utils/ipasPayments";
import { ipasDateIssue } from "@/utils/ipasDateLimits";
import { IPAS_LIMITS, amountSizeIssue, textLengthIssue } from "@/utils/ipasLimits";
import { PERCENT_ERROR, parsePercentInput, percentApplies } from "@/utils/ipasPaymentPercent";
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

/** The record's sections as the screen numbers them (digest SECTIONS): required fields are counted per these. */
const SCREEN_SECTIONS = [
  { key: "order", parts: ["header", "purchasing", "sales"] },
  { key: "payments", parts: [] },
  { key: "costs", parts: ["finance", "costing"] },
  { key: "delivery", parts: ["logistics", "status"] },
  { key: "documents", parts: [] },
];
const SCREEN_ORDER = SCREEN_SECTIONS.map((section) => section.key);

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
  purchasing: ["contact", "piNumber", "piQtAmount", "freight", "freightAmount", "freightCurrency", "freightBilled", "freightUrl", "withholding"],
  finance: ["bankName", "accountName", "accountNumber"],
  costing: ["split", "computationStatus"],
  filing: [],
  sales: ["sourceDoc", "analytic", "googleSheet", "ganttChart"],
  logistics: ["location", "directDelivery"],
  status: [
    "actualChecking",
  ],
};

const text = (value) =>
  value === null || value === undefined ? "" : String(value);

function actualCheckingItem(ipas) {
  return (
    (ipas.buyerFacts ?? []).find((item) => item.key === "actual_checking") ??
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

/**
 * What a new row under Payments is (#1225): "Paid already" (a payment) or "For payment (not paid yet)" (an ask for
 * payment). A new row starts with neither picked and will not save until one is. Charges reuse this (#1227).
 */
export const PAYMENT_MODE = { PAID: "paid", ASK: "ask" };

/** The ask's own boxes on a row picked as For payment. The amount and % of order share the row's own boxes. */
// `askCurrency` is "" for the PO's currency or "PHP" for a request in pesos (#1277); only a foreign-currency PO offers PHP.
const askDraftFields = () => ({ askPurpose: "down_payment", askPriority: IPAS_ASK_DEFAULT_PRIORITY, askNote: "", askCurrency: "" });

export const paymentDraft = (payment) => ({
  key: payment.id,
  id: payment.id,
  kind: payment.kind ?? IPAS_PAYMENT_KIND.PAYMENT,
  paidOn: payment.paid_on ?? "",
  amount: text(payment.amount),
  percentOfOrder: payment.percent_of_order ? text(payment.percent_of_order) : "",
  // A stored rate stays as it is until pesos are typed (#1278); pesos kept without a rate show in the pesos box.
  forexRate: payment.forex_rate ? text(payment.forex_rate) : "",
  phpDebited: !payment.forex_rate && payment.php_debited ? text(payment.php_debited) : "",
  chargeFeePhp: payment.bank_charge_php ? text(payment.bank_charge_php) : "",
  docStampPhp: payment.doc_stamp_php ? text(payment.doc_stamp_php) : "",
  miscFeePhp: payment.misc_fee_php ? text(payment.misc_fee_php) : "",
  methodId: payment.method_id ?? "",
  methodIsOthers: isOthersMethod(payment.method?.label),
  methodOther: payment.method_other ?? "",
  checkNo: payment.check_no ?? "",
  proofUrls: paymentProofFiles(payment).map((file) => file.url),
  askId: "", // only a new payment can be saved as paying an open ask (#1224)
  ...askDraftFields(),
  mode: PAYMENT_MODE.PAID, // a saved payment is paid
});

/** A new, empty payment row: today's date and the kind "Payment". `askId` is the open ask it pays, if any. */
export const newPaymentDraft = (askId = "", mode = "") => ({
  key: draftKey(),
  id: null,
  kind: IPAS_PAYMENT_KIND.PAYMENT,
  paidOn: getCurrentLocalDate(),
  amount: "",
  percentOfOrder: "",
  forexRate: "",
  phpDebited: "",
  chargeFeePhp: "",
  docStampPhp: "",
  miscFeePhp: "",
  methodId: "",
  methodIsOthers: false,
  methodOther: "",
  checkNo: "",
  proofUrls: [],
  askId,
  ...askDraftFields(),
  mode,
});

/** A Charge ask's own boxes on a charge row picked as For payment (#1227): currency (PHP to start), priority, note. */
const chargeAskFields = () => ({ askCurrency: "PHP", askPriority: IPAS_ASK_DEFAULT_PRIORITY, askNote: "" });

export const chargeDraft = (charge) => ({
  key: charge.id,
  id: charge.id,
  kindId: charge.kind_id ?? "",
  chargedOn: charge.charged_on ?? "",
  amountPhp: text(charge.amount_php),
  attachmentUrl: charge.attachment_url ?? "",
  askId: "", // only a new charge can be saved as paying an open Charge ask (#1227)
  askHint: null, // a foreign-currency ask's asked amount, shown while the pesos are typed
  ...chargeAskFields(),
  mode: PAYMENT_MODE.PAID, // a saved charge is paid
});

/** A new, empty charge row. Like a payment it starts with neither Paid already nor For payment picked (#1227). */
export const newChargeDraft = (askId = "", mode = "") => ({
  key: draftKey(),
  id: null,
  kindId: "",
  chargedOn: getCurrentLocalDate(),
  amountPhp: "",
  attachmentUrl: "",
  askId,
  askHint: null,
  ...chargeAskFields(),
  mode,
});

export const documentDraft = (document) => ({
  key: document.id,
  id: document.id,
  purchasingHas: Boolean(document.purchasingHas),
  financeHas: Boolean(document.financeHas),
  // The document's files (#1153): saved ones carry their id, a file picked in this edit has none yet.
  files: (document.files ?? []).map((file) => ({ id: file.id, url: file.url, fileName: file.fileName })),
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
    freightAmount: text(ipas.freight_amount),
    freightCurrency: ipas.freight_currency ?? "",
    freightBilled: Boolean(ipas.freight_billed_by_supplier),
    freightUrl: ipas.freight_attachment_url ?? "",
    withholding: ipas.withholding ?? "",
    split: ipas.landedCostSplit ?? "value",
    computationStatus: ipas.computationStatus ?? "",
    bankName: bank?.bankName ?? "",
    accountName: bank?.accountName ?? "",
    accountNumber: bank?.accountNumber ?? "",
    googleSheet: Boolean(ipas.googleSheet),
    ganttChart: Boolean(ipas.ganttChart),
    location: ipas.item_location_id ?? "",
    directDelivery: ipas.direct_delivery === true,
    actualChecking: Boolean(actualCheckingItem(ipas)?.ticked),
    // Not typed: whether the PO is in pesos decides which payment boxes are required.
    isPhp: isPhpCurrency(ipas.currency),
    payments: (ipas.payments ?? []).map(paymentDraft),
    charges: (ipas.charges ?? []).map(chargeDraft),
    documents: (ipas.documents ?? []).map(documentDraft),
  };
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
  need("order", "f-contact", "Supplier's name", form.contact);
  need("order", "f-piNumber", "P.I #", form.piNumber);
  need("order", "f-piQtAmount", "P.I/QT Amount", form.piQtAmount);
  form.payments.forEach((p, i) => {
    const n = `Payment ${i + 1}`;
    if (!p.id) need("payments", `pay-${p.key}-mode`, `${n}: Paid already or For payment`, p.mode);
    if (p.mode === PAYMENT_MODE.ASK) {
      need("payments", `pay-${p.key}-amount`, `${n} amount`, p.amount);
      need("payments", `pay-${p.key}-askPriority`, `${n} priority`, p.askPriority);
      return;
    }
    if (!p.id && !p.mode) return;
    need("payments", `pay-${p.key}-paidOn`, `${n} date`, p.paidOn);
    need("payments", `pay-${p.key}-amount`, `${n} amount`, p.amount);
    // "Pesos taken from the bank" is optional (#604): not a required field.
    need("payments", `pay-${p.key}-methodId`, `${n} method`, p.methodId);
    if (p.methodIsOthers === true) need("payments", `pay-${p.key}-methodOther`, `${n} method (typed)`, p.methodOther);
  });
  form.charges.forEach((c, i) => {
    const n = `Charge ${i + 1}`;
    if (!c.id) need("costs", `chg-${c.key}-mode`, `${n}: Paid already or For payment`, c.mode);
    need("costs", `chg-${c.key}-kindId`, `${n} kind`, c.kindId);
    if (c.mode === PAYMENT_MODE.ASK) {
      need("costs", `chg-${c.key}-amountPhp`, `${n} amount`, c.amountPhp);
      need("costs", `chg-${c.key}-askCurrency`, `${n} currency`, c.askCurrency);
      need("costs", `chg-${c.key}-askPriority`, `${n} priority`, c.askPriority);
      return;
    }
    // A saved charge may be blank (unknown); only a new one must be filled in.
    if (!c.id && c.mode) {
      need("costs", `chg-${c.key}-chargedOn`, `${n} date`, c.chargedOn);
      need("costs", `chg-${c.key}-amountPhp`, `${n} amount`, c.amountPhp);
    }
  });
  form.documents
    .filter((d) => !d.id)
    .forEach((d, i) => {
      const n = `New document ${i + 1}`;
      need("documents", `doc-${d.key}-choice`, `${n}`, d.choice);
      if (d.choice === BY_HAND)
        need("documents", `doc-${d.key}-label`, `${n} name`, d.label);
    });
  // A Direct delivery never comes to our warehouse: no Item Location is asked for (#1158).
  if (!form.directDelivery) need("delivery", "f-location", "Item Location", form.location);
  return out.sort(
    (a, b) =>
      SCREEN_ORDER.indexOf(a.section) - SCREEN_ORDER.indexOf(b.section),
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
  return SCREEN_SECTIONS.map((section) => {
    const mine = all.filter((f) => f.section === section.key);
    let left = mine.filter((f) => !f.filled).length;
    const blankCharges =
      section.key === "costs"
        ? (form.charges ?? []).filter(
            (c) => c.amountPhp === "" || c.amountPhp === null || c.amountPhp === undefined || String(c.amountPhp).trim() === "",
          ).length
        : 0;
    const hasBlankCharges = blankCharges > 0;
    if (hasBlankCharges && left === 0) left = blankCharges;
    const complete = mine.length > 0 && left === 0 && !hasBlankCharges;
    const filled =
      mine.length === 0 &&
      (section.parts.some((part) => sectionFilled(form, part)) ||
        (section.key === "payments" && form.payments.length > 0) ||
        (section.key === "documents" && form.documents.length > 0));
    return {
      key: section.key,
      title: section.key,
      total: mine.length,
      left,
      done: Math.max(0, mine.length - left),
      filled,
      hasBlankCharges,
      complete,
    };
  });
}

// ── What a Save sends ───────────────────────────────────────────────────────

function positive(raw) {
  const parsed = parseAmountInput(raw);
  return parsed.ok && parsed.value !== null && parsed.value > 0;
}

function paymentProblem(p, isPhp) {
  if (!p.id && !p.mode) return "Pick Paid already or For payment (not paid yet).";
  if (!isIsoDate(p.paidOn)) return "Give the date of the payment.";
  const dateIssue = ipasDateIssue(p.paidOn, "The payment date");
  if (dateIssue) return dateIssue;
  if (!positive(p.amount)) return "Amount must be a number more than zero.";
  if (percentApplies(p.kind) && !parsePercentInput(p.percentOfOrder).ok) return PERCENT_ERROR;
  // Blank is fine (#604); a figure that is given has to be a number above zero.
  if (!isPhp && !blank(p.phpDebited) && !positive(p.phpDebited))
    return "Pesos taken from the bank must be a number more than zero, or left blank.";
  if (!parseAmountInput(p.chargeFeePhp).ok)
    return "Bank charge must be a number.";
  if (!parseAmountInput(p.docStampPhp).ok)
    return "Doc stamp must be a number.";
  if (!parseAmountInput(p.miscFeePhp).ok)
    return "Misc fee must be a number.";
  if (!p.methodId) return "Pick the payment method.";
  if (p.methodIsOthers === true && blank(p.methodOther)) return "Type the payment method when it is Others.";
  return null;
}

/** True when a payment row asks in pesos on a foreign-currency PO (#1277). */
export const asksInPesos = (p, isPhpPo) => !isPhpPo && p.askCurrency === "PHP";

function askProblem(p, isPhpPo) {
  if (!positive(p.amount)) return "Amount must be a number more than zero.";
  if (!asksInPesos(p, isPhpPo) && !parsePercentInput(p.percentOfOrder).ok) return PERCENT_ERROR;
  if (!p.askPriority) return "Pick the priority.";
  return null;
}

/** A charge row picked as For payment: the kind, an amount in its currency (PHP to start) and a priority. */
function chargeAskProblem(c) {
  if (!c.kindId) return "Pick the kind of charge.";
  if (!/^[A-Za-z]{3}$/.test((c.askCurrency ?? "").trim())) return "Give the currency as three letters, like PHP.";
  if (!positive(c.amountPhp)) return "Amount must be a number more than zero.";
  if (!c.askPriority) return "Pick the priority.";
  return null;
}

function chargeProblem(c) {
  if (!c.kindId) return "Pick the kind of charge.";
  if (c.id) {
    // A saved charge may stay blank (#709): unknown amount, no date yet.
    if (!blank(c.chargedOn) && !isIsoDate(c.chargedOn)) return "Give the date of the charge.";
    if (!blank(c.chargedOn)) {
      const issue = ipasDateIssue(c.chargedOn, "The charge date");
      if (issue) return issue;
    }
    if (!blank(c.amountPhp) && !positive(c.amountPhp)) return "Amount must be a number more than zero, or left blank.";
    return null;
  }
  if (!isIsoDate(c.chargedOn)) return "Give the date of the charge.";
  const chargeDateIssue = ipasDateIssue(c.chargedOn, "The charge date");
  if (chargeDateIssue) return chargeDateIssue;
  if (!positive(c.amountPhp)) return "Amount must be a number more than zero.";
  return null;
}

function documentProblem(d) {
  if (!d.choice) return "Pick the document.";
  if (d.choice === BY_HAND && blank(d.label))
    return "Type the name of the document.";
  return null;
}

/** A row picked as For payment, as the ask RPC takes it. */
const askValues = (p, isPhpPo) => {
  const pesos = asksInPesos(p, isPhpPo);
  return {
    amount: parseAmountInput(p.amount).value,
    purpose: p.askPurpose,
    priority: p.askPriority,
    note: blank(p.askNote) ? null : p.askNote.trim(),
    percent: pesos ? null : parsePercentInput(p.percentOfOrder).value,
    currency: pesos ? "PHP" : null,
  };
};

/** A charge row picked as For payment, as the ask RPC takes it: a Charge ask of that kind, in that currency. */
const chargeAskValues = (c) => ({
  amount: parseAmountInput(c.amountPhp).value,
  purpose: "charge",
  chargeKindId: c.kindId,
  currency: c.askCurrency.trim().toUpperCase(),
  priority: c.askPriority,
  note: blank(c.askNote) ? null : c.askNote.trim(),
  percent: null,
});

const paymentValues = (p) => ({
  kind: p.kind,
  paidOn: p.paidOn,
  amount: p.amount,
  percentOfOrder: percentApplies(p.kind) ? p.percentOfOrder : "",
  forexRate: p.forexRate,
  phpDebited: p.phpDebited,
  chargeFeePhp: p.chargeFeePhp,
  docStampPhp: p.docStampPhp,
  miscFeePhp: p.miscFeePhp,
  methodId: p.methodId,
  methodIsOthers: p.methodIsOthers === true,
  methodOther: p.methodIsOthers === true ? p.methodOther : "",
  checkNo: p.checkNo,
  proofUrls: p.proofUrls,
  askId: p.askId ?? "",
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
    directDelivery: undefined,
    stamp: undefined,
    payments: { add: [], update: [], isPhpPo: form.isPhp },
    asks: { add: [] },
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
  if (["freightAmount", "freightCurrency", "freightBilled", "freightUrl"].some((key) => changed.has(key))) {
    if (!blank(form.freightAmount) && !parseAmountInput(form.freightAmount).ok) fail("Freight must be a number.");
    plan.freight = {
      amount: form.freightAmount,
      currency: form.freightCurrency,
      billedBySupplier: form.freightBilled,
      attachmentUrl: form.freightUrl,
    };
  }
  if (changed.has("withholding")) plan.withholding = form.withholding;
  if (changed.has("split")) plan.header.landedCostSplit = form.split;
  if (
    changed.has("piQtAmount") &&
    !blank(form.piQtAmount) &&
    !parseAmountInput(form.piQtAmount).ok
  ) {
    fail("P.I/QT Amount must be a number.");
  }
  if (changed.has("piQtAmount") && !blank(form.piQtAmount)) {
    const parsed = parseAmountInput(form.piQtAmount);
    const issue = parsed.ok ? amountSizeIssue(parsed.value) : null;
    if (issue) fail(issue);
  }
  for (const [key, what, max] of [
    ["piNumber", "P.I #", IPAS_LIMITS.piNumber],
    ["contact", "Supplier's name", IPAS_LIMITS.contact],
    ["remarks", "Remarks", IPAS_LIMITS.remarks],
  ]) {
    if (!changed.has(key)) continue;
    const issue = textLengthIssue(form[key], what, max);
    if (issue) fail(issue);
  }
  if (changed.has("location") && !form.directDelivery) plan.location = form.location || null;
  if (changed.has("directDelivery")) plan.directDelivery = form.directDelivery === true;
  if (changed.has("actualChecking")) plan.stamp = form.actualChecking;

  const pay = rowChanges(form, base, "payments");
  for (const [target, rows] of [
    ["add", pay.added],
    ["update", pay.updated],
  ]) {
    for (const row of rows) {
      if (row.mode === PAYMENT_MODE.ASK) {
        const askIssue = askProblem(row, form.isPhp);
        if (askIssue) fail(`Payment ${form.payments.indexOf(row) + 1}: ${askIssue}`);
        plan.asks.add.push({ key: row.key, values: askValues(row, form.isPhp) });
        continue;
      }
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
      if (!row.id && !row.mode) fail(`Charge ${form.charges.indexOf(row) + 1}: Pick Paid already or For payment.`);
      if (row.mode === PAYMENT_MODE.ASK) {
        const askIssue = chargeAskProblem(row);
        if (askIssue) fail(`Charge ${form.charges.indexOf(row) + 1}: ${askIssue}`);
        plan.asks.add.push({ key: row.key, values: chargeAskValues(row) });
        continue;
      }
      const problem = chargeProblem(row);
      if (problem) fail(`Charge ${form.charges.indexOf(row) + 1}: ${problem}`);
      plan.charges[target].push({
        key: row.key,
        id: row.id,
        values: {
          kindId: row.kindId,
          chargedOn: row.chargedOn,
          amountPhp: row.amountPhp,
          attachmentUrl: row.attachmentUrl,
          askId: row.askId ?? "",
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
    const kept = new Set(row.files.filter((file) => file.id).map((file) => file.id));
    const removed = before.files.filter((file) => file.id && !kept.has(file.id)).map((file) => file.id);
    const added = row.files.filter((file) => !file.id).map((file) => ({ url: file.url, fileName: file.fileName }));
    if (removed.length > 0) item.removeFileIds = removed;
    if (added.length > 0) item.addFiles = added;
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
    plan.directDelivery === undefined &&
    plan.freight === undefined &&
    plan.withholding === undefined &&
    plan.stamp === undefined &&
    plan.payments.add.length + plan.payments.update.length + plan.asks.add.length === 0 &&
    plan.charges.add.length + plan.charges.update.length === 0 &&
    plan.documents.add.length + plan.documents.update.length === 0 &&
    plan.bank === undefined &&
    plan.status === undefined
  );
}
