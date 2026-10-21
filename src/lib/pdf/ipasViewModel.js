/**
 * Pure mapping from `ipasService.get`'s result to exactly what the printed IPAS
 * says (spec #241 "Printed IPAS", issue #250). No I/O, no HTML: the composer
 * (ipasDocument.js) draws it, the printer (ipasPrinter.js) fetches and prints.
 *
 * Every value is read off the IPAS or derived from it, so the paper never says
 * more than the ERP does. The rules that live here, because they decide what is
 * safe to put on paper:
 *
 *   - A sign-off prints three ways: a stored signature prints as the signature,
 *     a signer with none (or who declined) as the name only, and a box still
 *     waiting as "Signature required".
 *   - Landed Cost carries its mark: provisional until LC Odoo Done, final
 *     after, and a filed IPAS is always final.
 *   - Statuses Odoo stamped carry a mark; the Odoo read time goes in the footer.
 *   - Account numbers print as the last four, in full only on the filing copy.
 *   - Bank details print only when the person printing may read them, filing
 *     copy included: the database returns none to anyone else, and this
 *     double-checks it.
 *
 * Strings are raw text. The composer escapes them.
 */

import {
  IPAS_COMPUTATION_STATUSES,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_LANDED_COST_REASON,
  IPAS_LANDED_COST_SPLIT_LABELS,
  IPAS_LANDED_COST_STATUS,
  IPAS_PAYMENT_KIND_LABELS,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  ipasSectionName,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_STATE,
  IPAS_STATUS_SOURCE,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
  ODOO_PO_STATE_LABELS,
} from '../../constants/ipas';
import { filingChecklist } from '../../utils/ipasDocuments';
import { formatDay } from '../../utils/ipasPayments';
import { isLandedCostFinal } from '../../utils/ipasSignoffs';
import { isPhpCurrency } from '../../utils/landedCost';

/** The printed form is read in the company's own timezone, wherever it is printed. */
const PRINT_TIMEZONE = 'Asia/Manila';
const BLANK = '—';
/** Typed in place of a number that is too short to show a last four of. */
const MASK = '••••';

const text = (value) => {
  const out = typeof value === 'string' ? value.trim() : '';
  return out === '' ? null : out;
};

const numberText = (value) =>
  new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

/**
 * An amount with its currency code, "USD 640.00" / "PHP 36,160.00". A code, not
 * a symbol: the paper reads the same in any font, and Odoo's "Php" is PHP.
 */
export function printAmount(value, currency = null) {
  if (value === null || value === undefined || value === '') return BLANK;
  const n = Number(value);
  if (!Number.isFinite(n)) return BLANK;
  const code = text(currency);
  return code ? `${code.toUpperCase()} ${numberText(n)}` : numberText(n);
}

const peso = (value) => printAmount(value, 'PHP');

/** A timestamp in the company's timezone: "Oct 13, 2026 14:05". */
export function printDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: PRINT_TIMEZONE,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute}`;
}

/** The date part of a timestamp in the company's timezone: "Oct 13, 2026". */
export function printDate(value) {
  const stamp = printDateTime(value);
  return stamp ? stamp.slice(0, stamp.lastIndexOf(' ')) : null;
}

/**
 * An account number as paper may show it: the last four characters behind a
 * mask. A number of four characters or fewer is masked whole: showing its last
 * four would be showing it. Blank stays blank.
 */
export function maskAccountNumber(raw) {
  const compact = String(raw ?? '').replace(/[\s-]/g, '');
  if (compact === '') return null;
  if (compact.length <= 4) return MASK;
  return `${MASK} ${compact.slice(-4)}`;
}

// ── Sign-offs ────────────────────────────────────────────────────────────────

const SIGN_LABELS = {
  [IPAS_SIGNOFF_ROLE.PREPARED]: 'Submitted by',
  [IPAS_SIGNOFF_ROLE.APPROVED]: 'Approved by',
  [IPAS_SIGNOFF_ROLE.RECEIVED]: 'Received by',
  [IPAS_SIGNOFF_ROLE.NOTED]: 'Noted by',
  [IPAS_SIGNOFF_ROLE.CHECKED]: 'Checked by',
};

/**
 * One box, in the shape `sigBlock` draws:
 *
 *   state 'awaiting'  nobody has signed it yet: "Signature required"
 *   state 'signed'    signed in the ERP. `signaturePath` is the signature as it
 *                     was when they signed (so a later upload never rewrites an
 *                     old print), or null for the name only: they had none, or
 *                     they declined to apply it (`signatureDeclined`).
 */
export function signoffBox(role, section, signoff) {
  const label = SIGN_LABELS[role] ?? IPAS_SIGNOFF_ROLE_LABELS[role] ?? role;
  const title = ipasSectionName(section);
  if (!signoff) return { role: label, who: '', title, state: 'awaiting', signaturePath: null, signatureDeclined: false };

  const who = text(signoff.signedBy?.name) ?? 'Unknown signer';
  const declined = Boolean(signoff.signatureDeclined);
  const path = !declined ? text(signoff.signatureVersion) : null;
  const when = printDateTime(signoff.signedAt);

  let stamp;
  if (path) stamp = `e-signed${when ? ` ${when}` : ''}`;
  else if (declined) stamp = `signed${when ? ` ${when}` : ''} · signature not applied`;
  else stamp = `signed${when ? ` ${when}` : ''} · name only, no signature on file`;

  return { role: label, who, title, state: 'signed', signaturePath: path, signatureDeclined: declined, stamp };
}

const signoffPair = (section, state = {}) => [
  signoffBox(IPAS_SIGNOFF_ROLE.PREPARED, section, state.prepared),
  signoffBox(IPAS_SIGNOFF_ROLE.APPROVED, section, state.approved),
];

// ── Section 6 ────────────────────────────────────────────────────────────────

/** What Odoo says about a stamped status, in a few words. */
function odooDetail(key, statuses = {}) {
  const { purchaseOrder, receivedInOdoo, createBill } = statuses;
  if (key === 'purchase_order') return ODOO_PO_STATE_LABELS[purchaseOrder?.state] ?? null;
  if (key === 'received_in_odoo' && receivedInOdoo) {
    const word = receivedInOdoo.ticked ? 'Received' : receivedInOdoo.partial ? 'Partly received' : 'Not received';
    return receivedInOdoo.receiptsTotal > 0
      ? `${word} · ${receivedInOdoo.receiptsDone} of ${receivedInOdoo.receiptsTotal} receipts`
      : receivedInOdoo.ticked || receivedInOdoo.partial
        ? word
        : null;
  }
  if (key === 'create_bill' && createBill?.ticked) {
    if (createBill.draftsOnly) return `${createBill.count} draft ${createBill.count === 1 ? 'bill' : 'bills'}`;
    return `${createBill.count} ${createBill.count === 1 ? 'bill' : 'bills'}${createBill.drafts ? `, ${createBill.drafts} in draft` : ''}`;
  }
  return null;
}

function trackItem(item, statuses) {
  const stampedFromOdoo = item.source === IPAS_STATUS_SOURCE.ODOO;
  let detail = item.detail ?? null;
  if (stampedFromOdoo) detail = (!item.ticked && item.reason) || odooDetail(item.key, statuses);
  else if (item.source === IPAS_STATUS_SOURCE.TYPED || item.source === IPAS_STATUS_SOURCE.STAMPED) {
    const parts = [];
    if (item.on) parts.push(formatDay(item.on));
    const who = text(item.by?.name);
    if (item.ticked && who) parts.push(`${item.source === IPAS_STATUS_SOURCE.TYPED ? 'typed' : 'stamped'} by ${who}`);
    if (item.ticked && !item.on && item.at) parts.push(printDate(item.at));
    detail = parts.join(' · ') || null;
  }
  return {
    key: item.key,
    label: item.label,
    ticked: Boolean(item.ticked),
    partial: Boolean(item.partial) && !item.ticked,
    stampedFromOdoo,
    detail,
  };
}

function landedCostOf(ipas, filed, charges) {
  const lc = ipas.landedCost;
  if (!lc) return { status: IPAS_LANDED_COST_STATUS.UNAVAILABLE, label: 'Not available', note: null, lines: [], total: null, build: [], perUnit: null, units: null };

  if (lc.status === IPAS_LANDED_COST_STATUS.UNAVAILABLE) {
    const note =
      lc.reason === IPAS_LANDED_COST_REASON.NO_PAYMENTS
        ? `This Odoo PO is in ${lc.currency || 'a foreign currency'}. Landed Cost converts at the rate actually paid, so it needs a payment with the PHP debited.`
        : 'The Odoo PO has no item lines to cost.';
    return { status: lc.status, label: 'Not available', note, lines: [], total: null, build: [], perUnit: null, units: null };
  }

  // A filed IPAS is final whatever the computation status says.
  const status = filed ? IPAS_LANDED_COST_STATUS.FINAL : lc.status;
  const notes = [];
  if (lc.isForeign && lc.rate) {
    notes.push(`Converted at ${lc.rate.rate.toFixed(4)} PHP per ${lc.currency}, the rate actually paid.`);
  }
  notes.push(`Charges, charge fees and shipping fees spread ${(IPAS_LANDED_COST_SPLIT_LABELS[lc.usedSplit] ?? '').toLowerCase()}.`);

  // How the total is made: the goods, then everything spread over them. These
  // are the same totals the calculation adds, so the rows sum to the figure.
  const totals = lc.totals ?? {};
  const build = [
    {
      label: 'Goods',
      basis: lc.isForeign && lc.rate ? `at ${lc.rate.rate.toFixed(4)} PHP per ${lc.currency}` : 'as the PO prices them',
      amount: peso(totals.goodsPhp),
    },
    { label: 'Shipping fees', basis: 'shipping payments', amount: peso(totals.shippingFeesPhp) },
    { label: 'Bank charge fees', basis: 'on payments', amount: peso(totals.chargeFeesPhp) },
    ...charges.map((charge) => ({ label: charge.kind, basis: charge.date, amount: charge.amount })),
  ];
  // One line reads per unit; several lines read as the number of lines.
  const only = lc.lines.length === 1 ? lc.lines[0] : null;

  return {
    status,
    build,
    perUnit: only ? peso(only.landedPerUnitPhp) : null,
    units: only ? `${only.quantity}${text(only.unit) ? ` ${only.unit}` : ''}` : `${lc.lines.length} lines`,
    label: status === IPAS_LANDED_COST_STATUS.FINAL ? 'Final' : 'Provisional',
    note: notes.join(' '),
    lines: lc.lines.map((line) => ({
      name: line.name || BLANK,
      quantity: line.quantity,
      unit: line.unit ?? null,
      perUnit: peso(line.landedPerUnitPhp),
      total: peso(line.landedPhp),
    })),
    total: peso(lc.totals?.landedPhp),
  };
}

// ── The view model ───────────────────────────────────────────────────────────

/**
 * @param {object} ipas    `ipasService.get`'s result (or `getForPrint`'s)
 * @param {object} [options]
 * @param {boolean} [options.filingCopy]  print account numbers in full (honoured only when the IPAS is filed)
 * @param {string}  [options.printedAt]   when it was printed (ISO), for the footer
 * @param {string}  [options.printedBy]   who printed it, for the footer
 */
export function buildIpasViewModel(ipas, { filingCopy = false, printedAt = null, printedBy = null } = {}) {
  if (!ipas) throw new Error('An IPAS is needed to print.');

  const filed = ipas.state === IPAS_STATE.FILED;
  // The filing copy exists only for a filed IPAS; anything else prints masked.
  filingCopy = Boolean(filingCopy) && filed;
  const currency = ipas.currency ?? null;
  const isPhp = isPhpCurrency(currency);
  const overrides = ipas.overrides ?? {};
  const sors = Array.isArray(ipas.sors) ? ipas.sors : [];
  const lines = Array.isArray(ipas.lines) ? ipas.lines : [];
  const payments = Array.isArray(ipas.payments) ? ipas.payments : [];
  const charges = Array.isArray(ipas.charges) ? ipas.charges : [];
  const documents = Array.isArray(ipas.documents) ? ipas.documents : [];
  const summary = ipas.paymentSummary ?? {};
  const statuses = ipas.statuses ?? {};
  const state7 = ipas.signoffSections?.[7] ?? {};

  const field = (key) => {
    const o = overrides[key];
    return o ? { value: text(o.value), overridden: Boolean(o.overridden), odoo: text(o.odoo) } : { value: null, overridden: false, odoo: null };
  };

  // ── Header ──
  const header = {
    entity: field('entity'),
    priority: IPAS_PRIORITY_LABELS[ipas.priority] ?? text(ipas.priority) ?? BLANK,
    source: IPAS_SOURCE_LABELS[ipas.source] ?? text(ipas.source) ?? BLANK,
    purpose: IPAS_PURPOSE_LABELS[ipas.purpose] ?? text(ipas.purpose) ?? BLANK,
    created: printDate(ipas.created_at) ?? BLANK,
    createdBy: text(ipas.creator?.name) ?? BLANK,
  };
  if (header.entity.value === null) header.entity.value = text(ipas.entity);

  // ── Section 1 ──
  const itemsTotal = lines.reduce((sum, line) => sum + (Number(line.price_subtotal) || 0), 0);
  const section1 = {
    supplier: text(ipas.supplier) ?? BLANK,
    contact: text(ipas.contact),
    currency: text(currency) ? String(currency).toUpperCase() : BLANK,
    poNumber: text(ipas.po_number) ?? BLANK,
    piNumber: text(ipas.piNumber),
    piQtAmount: ipas.piQtAmount === null || ipas.piQtAmount === undefined ? null : printAmount(ipas.piQtAmount, currency),
    items: lines.map((line) => ({
      name: text(line.name) ?? BLANK,
      brand: text(line.brand),
      quantity: `${line.quantity ?? BLANK}${text(line.unit) ? ` ${line.unit}` : ''}`,
      unitPrice: printAmount(line.price_unit, currency),
      amount: printAmount(line.price_subtotal, currency),
    })),
    itemsTotal: printAmount(itemsTotal, currency),
    payments: payments.map((payment) => {
      const method = text(payment.methodLabel);
      const checkNo = text(payment.check_no);
      return {
        kind: IPAS_PAYMENT_KIND_LABELS[payment.kind] ?? text(payment.kind) ?? BLANK,
        date: payment.paid_on ? formatDay(payment.paid_on) : BLANK,
        amount: printAmount(payment.amount, currency),
        // A PHP PO is paid in pesos: the amount is what was debited.
        phpDebited: isPhp ? peso(payment.amount) : peso(payment.php_debited),
        chargeFee: Number(payment.charge_fee_php) > 0 ? peso(payment.charge_fee_php) : BLANK,
        method: method ? `${method}${checkNo ? ` · ${checkNo}` : ''}` : BLANK,
        proofOfPayment: Boolean(payment.hasProof ?? payment.proof_url),
      };
    }),
    totalDebited: peso(summary.totalDebitedPhp ?? 0),
    missingPhp: Number(summary.missingPhp) || 0,
    signoffs: signoffPair(1, ipas.signoffSections?.[1]),
  };

  // ── Section 2 ──
  const section2 = {
    sors: sors.map((sor) => ({
      reference: text(sor.salesReference) ?? BLANK,
      title: text(sor.projectTitle),
    })),
    googleSheet: ipas.googleSheet === true,
    ganttChart: ipas.ganttChart === true,
    sourceDoc: field('source_doc'),
    analytic: field('analytic'),
  };

  // ── Section 3 ──
  const chargesTotal = Number(summary.chargesPhp) || 0;
  const canReadBank = Boolean(ipas.canReadBankDetails);
  let bank = null;
  if (canReadBank) {
    const details = ipas.bankDetails ?? null;
    const raw = text(details?.accountNumber);
    bank = {
      present: Boolean(details),
      bankName: text(details?.bankName),
      accountName: text(details?.accountName),
      accountNumber: raw === null ? null : filingCopy ? raw : maskAccountNumber(raw),
      masked: raw !== null && !filingCopy,
      flagged: Boolean(details?.flagged),
    };
  }
  const section3 = {
    charges: charges.map((charge) => ({
      kind: text(charge.kindLabel) ?? BLANK,
      date: charge.charged_on ? formatDay(charge.charged_on) : BLANK,
      amount: peso(charge.amount_php),
    })),
    chargesTotal: peso(chargesTotal),
    documents: documents.map((doc) => ({
      label: doc.label,
      purchasing: Boolean(doc.purchasingHas),
      finance: Boolean(doc.financeHas),
    })),
    bank,
    signoffs: signoffPair(3, ipas.signoffSections?.[3]),
  };

  // ── Section 5 ── Item Location and the Transmittals carrying the IPAS (#256)
  const section5 = {
    itemLocation: text(ipas.itemLocation?.label),
    tg03: (ipas.slips ?? []).map((slip) => ({
      number: text(slip.number),
      date: text(slip.date),
      priority: text(slip.priority),
      stateLabel: text(slip.stateLabel),
      naCount: slip.naCount ?? 0,
    })),
  };

  // ── Section 6 ──
  const origin = ipas.supplierOrigin
    ? IPAS_SUPPLIER_ORIGIN_FIELDS.map(({ field: key, label }) => ({
        label,
        date: ipas.supplierOrigin[key] ? formatDay(ipas.supplierOrigin[key]) : null,
      }))
    : null;
  const buyerTrack = (Array.isArray(ipas.buyerTrack) ? ipas.buyerTrack : []).map((item) => trackItem(item, statuses));
  const reached = IPAS_COMPUTATION_STATUSES.indexOf(ipas.computationStatus);
  const computation = IPAS_COMPUTATION_STATUSES.map((status, index) => ({
    key: status,
    label: IPAS_COMPUTATION_STATUS_LABELS[status],
    reached: index <= reached,
    current: index === reached,
  }));
  const landedCost = landedCostOf(ipas, filed, section3.charges);
  const section6 = {
    origin,
    buyerTrack,
    computation,
    landedCost,
    // Section 3's sign-offs (stored section 6): Submitted and Approved.
    signoffs: signoffPair(6, ipas.signoffSections?.[6]),
    // The legend prints whenever a status carries the mark.
    hasOdooMarks: buyerTrack.some((item) => item.stampedFromOdoo),
  };

  // ── Section 7 ──
  const checklist = [
    {
      label: 'LC Odoo Done',
      ticked: isLandedCostFinal(ipas.computationStatus),
      detail: `Computation status: ${IPAS_COMPUTATION_STATUS_LABELS[ipas.computationStatus] ?? BLANK}`,
    },
    ...filingChecklist(documents).map((doc) => ({
      label: doc.label,
      ticked: Boolean(doc.ticked),
      detail:
        doc.purchasingHas && doc.financeHas
          ? 'Purchasing and Finance'
          : doc.purchasingHas
            ? 'Purchasing'
            : doc.financeHas
              ? 'Finance'
              : null,
    })),
  ];
  const section7 = {
    checklist,
    signoffs: [
      signoffBox(IPAS_SIGNOFF_ROLE.RECEIVED, 7, state7.received),
      signoffBox(IPAS_SIGNOFF_ROLE.NOTED, 7, state7.noted),
      signoffBox(IPAS_SIGNOFF_ROLE.CHECKED, 7, state7.checked),
      signoffBox(IPAS_SIGNOFF_ROLE.APPROVED, 7, state7.approved),
    ],
  };

  // ── Footer ──
  const refresh = ipas.refresh ?? null;
  const readAt = printDateTime(ipas.odoo_fetched_at);
  let odooNote = null;
  if (filed) odooNote = 'frozen at filing';
  else if (refresh && refresh.ok === false) odooNote = "Odoo didn't answer when this was printed; this is the last copy";

  const stateLabel =
    ipas.state === IPAS_STATE.FILED
      ? `Filed${printDate(ipas.filed_at) ? ` ${printDate(ipas.filed_at)}` : ''}`
      : ipas.state === IPAS_STATE.CANCELLED
        ? 'Cancelled'
        : 'Open · not yet filed';

  return {
    type: 'IPAS',
    number: text(ipas.number) ?? BLANK,
    poNumber: section1.poNumber,
    state: ipas.state,
    stateLabel,
    filed,
    filingCopy: Boolean(filingCopy),
    header,
    section1,
    section2,
    section3,
    section5,
    section6,
    section7,
    footer: {
      reference: [text(ipas.number), ...sors.map((sor) => text(sor.salesReference))].filter(Boolean).join(' · '),
      landedCost: landedCost.status === IPAS_LANDED_COST_STATUS.UNAVAILABLE ? null : `Landed Cost ${landedCost.label.toLowerCase()}`,
      odooRead: readAt ? `Odoo copy read ${readAt}` : 'Odoo copy not read yet',
      odooNote,
      printed: printedAt ? `Printed ${printDateTime(printedAt)}${printedBy ? ` by ${printedBy}` : ''}` : null,
    },
  };
}
