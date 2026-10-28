/**
 * The printed Canvass (issue #282, spec #275, ADR 0014): A4 portrait, the recommendation first and
 * every Offer tabled beneath as evidence. A pure view model over a Canvass as `canvassService.get`
 * returns it, with no I/O, so the decision block, the foreign-currency lines, the under-three
 * warning and the signature states are unit-tested without the network. The document
 * (canvassDocument.js) draws it; the printer (canvassPrinter.js) fetches and prints.
 *
 *   Header      the CNV number, the SOR and Component ("S07983 · 1.2 Ambulance Folding Stretcher")
 *               or the Requested Item
 *   Decision    the chosen supplier, brand, lead time, validity, the unit price large in the quoted
 *               currency (the PHP figure and rate beneath where foreign), and the reason as written
 *   Slots       the three supplier slots: each an Offer's supplier or "No other supplier" with its reason
 *   Offers      side by side: one column per supplier, one row per detail (what was offered,
 *               quoted, PHP figure, lead time, quality, validity, brochure, remarks), the chosen
 *               column marked; more than four suppliers continue in a second table below
 *   Warning     "Two offers only — below the three-offer minimum", above the signatures; it still prints
 *   Signatures  Canvassed by, Checked by, Approved by
 *
 * Every figure comes from canvassMath, so the paper agrees with the screen. This sheet is money: a
 * Canvass read without the money tier carries no prices, and `canPrintCanvass` says no. The builder
 * still never invents a figure the Canvass didn't carry (a blank prints as a dash, never zero).
 *
 * A signature block prints three ways: a stored signature as the signature, a signer with none as the
 * name only, and a block still waiting as "Signature required".
 *
 * Strings are raw text. The composer escapes them.
 */

import { moreOffersWarning, offerCurrency, phpFigure, supplierSlots } from '../../utils/canvassMath';
import { DEFAULT_CURRENCY } from '../../constants/canvass';
import { printAmount, printDate } from './ipasViewModel';

const BLANK = '—';

const text = (value) => {
  const out = typeof value === 'string' ? value.trim() : '';
  return out === '' ? null : out;
};

const isBlank = (value) => value === null || value === undefined || value === '';

/** Whether this reader may print the Canvass: only a reader who received the money keys. */
export const canPrintCanvass = (canvass) => Boolean(canvass?.canReadMoney);

/** The comparison rate as written, without trailing zeros or grouping: "56.5625". */
const rateText = (rate) =>
  new Intl.NumberFormat('en-PH', { minimumFractionDigits: 0, maximumFractionDigits: 6, useGrouping: false }).format(Number(rate));

/**
 * "S07983 · 1.2 Ambulance Folding Stretcher", "S07983 · Requested Item · Gloves" for an item, or
 * just the product ("Laser printer toner") for a Canvass with no subject yet (ADR 0034).
 */
export function subjectLine(subject = {}) {
  if (subject.product) return text(subject.product.name) ?? BLANK;
  const sor = text(subject.sor);
  if (subject.requestedItem) {
    return [sor, 'Requested Item', text(subject.requestedItem.name)].filter(Boolean).join(' · ');
  }
  const component = subject.component ?? {};
  const named = [text(component.number), text(component.name)].filter(Boolean).join(' ');
  return [sor, named].filter(Boolean).join(' · ') || BLANK;
}

/** An Offer's amount as quoted ("PHP 78,000.00", "USD 1,280.00"), or a dash when there is no price. */
const quoted = (offer) => (isBlank(offer.unit_price) ? BLANK : printAmount(offer.unit_price, offerCurrency(offer)));

/** The PHP figure beneath a foreign quote: "≈ PHP 72,400.00 at 56.5625", or why there is none. */
function foreignLine(offer) {
  if (offerCurrency(offer) === DEFAULT_CURRENCY || isBlank(offer.unit_price)) return null;
  const php = phpFigure(offer);
  if (php === null) return 'no comparison rate recorded';
  return `≈ ${printAmount(php, 'PHP')} at ${rateText(offer.comparison_rate)}`;
}

function offerRow(offer) {
  const php = phpFigure(offer);
  const brochure = Array.isArray(offer.brochure) ? offer.brochure : [];
  return {
    chosen: Boolean(offer.is_winner),
    supplier: text(offer.supplier_name) ?? BLANK,
    brand: text(offer.brand),
    offered: text(offer.description) ?? BLANK,
    remarks: text(offer.remarks),
    quoted: quoted(offer),
    php: php === null ? BLANK : printAmount(php, 'PHP'),
    foreign: foreignLine(offer),
    leadTime: text(offer.lead_time) ?? BLANK,
    quality: text(offer.quality_note) ?? BLANK,
    validUntil: printDate(offer.valid_until) ?? BLANK,
    brochure: brochure.length > 0 ? brochure.map((file) => text(file?.name) ?? 'Brochure').join(', ') : null,
  };
}

function decisionBlock(canvass, winner) {
  if (!winner) {
    return { chosen: false, supplier: 'No offer chosen yet', detail: null, price: null, foreign: null, reason: text(canvass.reason) };
  }
  const facts = [
    text(winner.brand),
    text(winner.lead_time) ? `lead time ${text(winner.lead_time)}` : null,
    winner.valid_until ? `quote valid to ${printDate(winner.valid_until)}` : null,
  ].filter(Boolean);
  return {
    chosen: true,
    supplier: text(winner.supplier_name) ?? BLANK,
    detail: facts.length > 0 ? facts.join(' · ') : null,
    price: quoted(winner),
    foreign: foreignLine(winner),
    reason: text(canvass.reason),
  };
}

/**
 * The three supplier slots as the paper prints them (#721): the supplier of an Offer, or "No other
 * supplier" with its reason, who said so and when, or "Not filled".
 */
export function slotRows(offers = [], marks = []) {
  const { slots } = supplierSlots(offers, marks);
  return slots.map((s) => {
    if (s.kind === 'offer') return { slot: s.slot, kind: 'offer', label: text(s.offer.supplier_name) ?? text(s.offer.brand) ?? BLANK, reason: null, by: null };
    if (s.kind === 'none') {
      const when = printDate(s.mark.created_at);
      const by = [text(s.mark.actor?.name), when].filter(Boolean).join(' · ');
      return { slot: s.slot, kind: 'none', label: 'No other supplier', reason: text(s.mark.reason) ?? BLANK, by: by || null };
    }
    return { slot: s.slot, kind: 'empty', label: 'Not filled', reason: null, by: null };
  });
}

/** How many suppliers sit side by side in one comparison table on portrait A4. */
export const OFFERS_PER_TABLE = 4;

/**
 * The Offers cut into comparison tables of at most OFFERS_PER_TABLE suppliers each, in their own
 * order, so a fifth supplier starts a second table under the same row labels rather than squeezing
 * the columns. Each group says which Offers it holds ("Offers 5–7 of 7") when there is more than one.
 */
export function offerGroups(rows, perTable = OFFERS_PER_TABLE) {
  const groups = [];
  for (let start = 0; start < rows.length; start += perTable) {
    const offers = rows.slice(start, start + perTable);
    const end = start + offers.length;
    groups.push({
      offers,
      label: rows.length > perTable ? `Offers ${start + 1}${end > start + 1 ? `–${end}` : ''} of ${rows.length}` : null,
    });
  }
  return groups;
}

/**
 * One signature block in the shape `sigBlock` draws.
 *   state 'awaiting'  nobody has signed it: "Signature required"
 *   state 'signed'    `signaturePath` is the signer's stored signature, or null for the name only
 */
export function signatureBlock(role, title, { who = null, at = null, signaturePath = null, verb = 'signed' } = {}) {
  const name = text(who);
  if (!name) return { role, title, who: '', state: 'awaiting', signaturePath: null };
  const when = printDate(at);
  const base = `${verb}${when ? ` ${when}` : ''}`;
  return {
    role,
    title,
    who: name,
    state: 'signed',
    signaturePath: text(signaturePath),
    stamp: signaturePath ? base : `${base} · name only, no signature on file`,
  };
}

/**
 * The Canvass as the paper prints it.
 *
 *   canvass   `canvassService.get`'s result (Offers carry their price keys only for a money reader)
 *   subject   `{ sor, component: { number, name } }`, `{ sor, requestedItem: { name } }`, or
 *             `{ product: { name } }` for a Canvass with no subject yet
 *   people    `{ creator, approver }`, each `{ name, signaturePath?, at? }` or absent;
 *             `creator` prints as "Canvassed by" (the printer hands the Canvasser over)
 *
 * The Offers come twice: `offers`, one row per Offer, and `offerGroups`, the same rows cut into the
 * side-by-side comparison tables the sheet draws (suppliers as columns, details as rows).
 */
export function buildCanvassViewModel({ canvass, subject = {}, people = {} }, { printedAt = null, printedBy = null } = {}) {
  const offers = Array.isArray(canvass.offers) ? canvass.offers : [];
  const winner = offers.find((offer) => offer.is_winner) ?? null;
  const approved = Boolean(canvass.signed_off_at);
  const rows = offers.map(offerRow);

  return {
    number: canvass.number ?? BLANK,
    header: {
      subjectKind: subject.product ? 'Product' : subject.requestedItem ? 'Requested Item' : 'Component',
      subject: subjectLine(subject),
      sor: text(subject.sor),
      raised: printDate(canvass.created_at),
      offerCount: offers.length,
    },
    decision: decisionBlock(canvass, winner),
    slots: slotRows(offers, canvass.noOtherSupplier ?? []),
    offers: rows,
    offerGroups: offerGroups(rows),
    warning: moreOffersWarning(offers, canvass.noOtherSupplier ?? []),
    // Only "Canvassed by" is signed (#728, ADR 0047). An old Canvass that was signed off still
    // prints its "Approved by" from the read-only sign-off columns; there is no Check-by block.
    signatures: [
      signatureBlock('Canvassed by', 'Purchasing', {
        who: people.creator?.name,
        at: canvass.created_at,
        signaturePath: people.creator?.signaturePath,
        verb: 'canvassed',
      }),
      ...(approved
        ? [
            signatureBlock('Approved by', 'Purchasing approver', {
              who: people.approver?.name ?? canvass.signer?.name,
              at: canvass.signed_off_at,
              signaturePath: people.approver?.signaturePath,
              verb: 'e-signed',
            }),
          ]
        : []),
    ],
    printedOn: printDate(printedAt),
    printedBy: text(printedBy),
  };
}
