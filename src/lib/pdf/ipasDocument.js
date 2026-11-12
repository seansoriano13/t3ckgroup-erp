/**
 * The printed IPAS as HTML: one A4 portrait page of "flow rows" (spec #699, ticket #714), drawn in
 * the same document language as the HR leave slips (htmlPrinter.js): rail, serif name, one big
 * mono figure, hairlines and the shared signature box.
 *
 * Each part is a row: what it holds on the left, its own signature boxes in a 54mm column on the
 * right, so the signatures run down the page in the order the IPAS moved:
 *
 *   1 Purchasing, 2 Purchasing & Finance, 3 Computation & Landed Cost, 6 Logistics, 4 Filing, 7 Status
 *
 * Sales & Operation (5) has no sign-off; it prints as a plain row after Status so nothing the old
 * print showed is dropped. Numbers are the ones the screen shows (ipasSectionLabel, constants/ipas.js).
 *
 * Fitting: the page uses the paper set's `dense` step (7.8pt body, 7.4pt tables, paperSet.js),
 * the charges sit beside the Landed Cost build, and the five signatures share one row, so an
 * ordinary order fits one A4 sheet at a size that can be read. A longer order is not shrunk:
 * table rows never split, so what does not fit continues on a second sheet with the same margins.
 *
 * The view model keeps the stored section names (`section1`, `section3`, ...); only what is
 * printed is renumbered. There is no Transmittals list yet.
 *
 * Pure: a view model (ipasViewModel.js) in, a complete document string out.
 * `formHTML` and `sigBlock` concatenate strings without escaping, and an IPAS
 * carries text from Odoo and from people, so everything here goes through
 * `escapeHtml` before it is written, including what `sigBlock` is handed.
 */

import { ipasSectionLabel } from '../../constants/ipas';
import { MARK } from './brandMark';
import { PAPER_CSS } from './paperSet';
import { escapeHtml as esc, sigBlock } from './sigBlock';

/** What only the IPAS draws: its sections run as one flow down the page, set one step tighter (`dense`). */
const IPAS_CSS = `
  .flow { display: flex; flex-direction: column; gap: var(--s-4); }
  .frow { break-inside: avoid; page-break-inside: avoid; }
  .ticks { display: flex; flex-wrap: wrap; gap: 3px 14px; }
  .ticks span { display: inline-flex; gap: 4px; align-items: center; font-size: var(--t-table); }
  .track { display: flex; flex-direction: column; gap: var(--s-2); }
`;

/** The paper set plus the IPAS's own rules. Other forms import `PAPER_CSS` from paperSet.js. */
export const CSS = `${PAPER_CSS}${IPAS_CSS}`;

// ── Small pieces ─────────────────────────────────────────────────────────────

const tick = (on, part = false) =>
  `<span class="chk${on ? ' done' : part ? ' part' : ''}" aria-label="${on ? 'ticked' : part ? 'partly' : 'not ticked'}">${on ? '✓' : part ? '~' : ''}</span>`;

const field = (label, value, { mono = false, note = '' } = {}) =>
  `<div class="f"><span class="k">${esc(label)}</span><span class="v${mono ? ' mono' : ''}">${value}</span>${note ? `<span class="x">${note}</span>` : ''}</div>`;

const odooMark = '<span class="odoo" title="stamped from Odoo">●</span>';
const legend = '<span class="legend">● stamped from Odoo</span>';

const section = (title, aside, body) =>
  `<section class="sec"><h3><span>${title}</span>${aside ? `<b>${aside}</b>` : ''}</h3><div class="body">${body}</div></section>`;

/** An Odoo-sourced value as the IPAS uses it; when Purchasing overrode it, the note names Odoo's value beside it. */
const overridableValue = ({ value }) => (value ? esc(value) : '—');

/** The signature boxes: every string escaped before `sigBlock` concatenates it. A box prints the name with the call sign. */
function sigs(boxes) {
  const html = boxes
    .map((box) =>
      sigBlock({
        role: esc(box.role),
        who: esc(box.who ? (box.callSign ? `${box.callSign} · ${box.who}` : box.who) : ''),
        title: '',
        state: box.state,
        stamp: box.stamp ? esc(box.stamp) : undefined,
        signatureBase64: box.signatureBase64 ? esc(box.signatureBase64) : undefined,
      }),
    )
    .join('');
  return `<div class="sigs n${Math.min(boxes.length, 5)}">${html}</div>`;
}

/** A part's documents as ticks (#711): the files that belong to that part. */
const docTicks = (docs = []) =>
  docs.length ? `<div class="ticks">${docs.map((d) => `<span>${tick(d.have)} ${esc(d.label)}</span>`).join('')}</div>` : '';

// ── Chrome ───────────────────────────────────────────────────────────────────

function rail(vm, continued = false) {
  return `<div class="rail"><span class="mark">${MARK}</span>
    <span class="org"><b>T3CKGROUP</b>Purchasing department</span>
    <span class="doc"><div class="t">${esc(vm.number)}${vm.filingCopy ? '<span class="copy-mark">Filing copy</span>' : ''}</div>
    <div class="s">IPAS${continued ? ' · continued' : ''}</div></span></div>`;
}

/** Page 1's head: who it is from, and the one figure the form exists to prove. */
function head(vm) {
  const h = vm.header;
  const lc = vm.section6.landedCost;
  const stateClass = vm.filed ? ' filed' : vm.state === 'cancelled' ? ' cancelled' : '';
  const mark = `<span class="prov ${lc.status === 'final' ? 'final' : lc.status === 'unavailable' ? 'na' : ''}">${esc(lc.label)}</span>`;
  const figure =
    lc.status === 'unavailable'
      ? '<div class="big na">Not available</div>'
      : `<div class="big">${esc(lc.total.replace(/^PHP /, '₱'))}<em>PHP</em></div>`;
  const ledger =
    lc.status === 'unavailable'
      ? ''
      : `<div class="ledger">${lc.perUnit ? `${esc(lc.perUnit)} per unit · ` : ''}${esc(lc.units)}</div>`;
  const meta = [vm.poNumber, vm.footer.reference.split(' · ').slice(1).join(' · '), h.source, h.purpose, `${h.priority} priority`]
    .filter(Boolean)
    .map(esc)
    .join(' · ');
  return `<div class="head">
    <div class="l"><div class="kind">Integrated Purchasing and Shipping Form</div>
      <div class="who">${esc(vm.section1.supplier)}</div>
      <div class="meta">${meta}</div>
      <div class="company"><span class="k">Entity</span> <b>${overridableValue(h.entity)}</b></div></div>
    <div class="r"><div class="k">Landed Cost${mark}</div>${figure}${ledger}
      <div class="ledger"><span class="tag-state${stateClass}">${esc(vm.stateLabel)}</span></div></div>
  </div>`;
}

/** How the Landed Cost is made: the goods, then everything spread over them. */
function build(vm) {
  const lc = vm.section6.landedCost;
  if (lc.status === 'unavailable') {
    return `<div class="sub">${esc(lc.note ?? 'Landed Cost is not available yet.')}</div>`;
  }
  const rows = lc.build
    .map((r) => `<tr><td>${esc(r.label)}${r.basis ? ` <span class="basis">${esc(r.basis)}</span>` : ''}</td><td class="num">${esc(r.amount)}</td></tr>`)
    .join('');
  return `<table class="build"><thead><tr><th>How the Landed Cost is built</th><th class="num">PHP</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Landed Cost, ${esc(lc.units)}</td><td class="num">${esc(lc.total)}</td></tr></tfoot></table>${lc.note ? `<div class="sub">${esc(lc.note)}</div>` : ''}`;
}

function footer(vm) {
  const f = vm.footer;
  const middle = [f.landedCost, f.odooRead + (f.odooNote ? ` (${f.odooNote})` : '')].filter(Boolean).map(esc).join(' · ');
  return `<div class="foot">
    <span>${esc(f.reference)}${f.printed ? `<br>${esc(f.printed)}` : ''}</span>
    <span class="mid">${middle}</span>
    <span class="r">${esc(vm.number)}</span>
  </div>`;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function purchasing(vm) {
  const s = vm.section1;
  const items = s.items.length
    ? `<table><thead><tr>
        <th style="width:44%">Item</th><th style="width:14%">Brand</th>
        <th class="num" style="width:12%">Qty</th><th class="num" style="width:15%">Unit price</th><th class="num" style="width:15%">Amount</th>
      </tr></thead><tbody>${s.items
        .map(
          (item) => `<tr><td class="pre">${esc(item.name)}</td><td>${esc(item.brand ?? '—')}</td>
            <td class="num">${esc(item.quantity)}</td><td class="num">${esc(item.unitPrice)}</td><td class="num">${esc(item.amount)}</td></tr>`,
        )
        .join('')}</tbody>
      <tfoot><tr><td colspan="4" style="text-align:right">Total before tax, as Odoo prices the lines</td><td class="num">${esc(s.itemsTotal)}</td></tr></tfoot></table>`
    : '<div class="empty">The Odoo PO has no item lines.</div>';

  return orderSection(vm, s, items);
}

function paymentsTable(vm) {
  const s = vm.section1;
  return s.payments.length
    ? `<table class="pay"><thead><tr>
        <th style="width:19%">Payment</th><th style="width:12%">Date</th><th class="num" style="width:15%">Amount</th>
        <th class="num" style="width:17%">Pesos taken from the bank</th><th class="num" style="width:12%">Charge fee</th>
        <th style="width:17%">Method</th><th class="center" style="width:8%">Proof</th>
      </tr></thead><tbody>${s.payments
        .map(
          (p) => `<tr><td style="font-weight:600">${esc(p.kind)}</td><td class="m">${esc(p.date)}</td>
            <td class="num">${esc(p.amount)}</td><td class="num">${esc(p.phpDebited)}</td><td class="num">${esc(p.chargeFee)}</td>
            <td>${esc(p.method)}</td><td class="center">${tick(p.proofOfPayment)}</td></tr>`,
        )
        .join('')}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">Total debited, including charge fees</td><td class="num">${esc(s.totalDebited)}</td><td colspan="3"></td></tr></tfoot></table>${
        s.missingPhp
          ? `<div class="sub flag">${s.missingPhp} ${s.missingPhp === 1 ? 'payment has' : 'payments have'} no pesos taken from the bank yet, so the total is short.</div>`
          : ''
      }`
    : '<div class="empty">No payments recorded.</div>';
}

function orderSection(vm, s, items) {
  return section(
    esc(ipasSectionLabel('purchasing')),
    esc(s.poNumber),
    `<div class="fields">
      ${field('Supplier', esc(s.supplier))}
      ${field("Supplier's name", esc(s.contact ?? '—'))}
      ${field('Currency', esc(s.currency), { mono: true })}
      ${field('P.I #', esc(s.piNumber ?? '—'), { mono: true })}
      ${s.piQtAmount ? field('P.I/QT Amount', esc(s.piQtAmount), { mono: true }) : ''}
    </div>
    ${items}
    ${sorsOf(vm)}`,
  );
}

/** 1 · Order: what was bought, from whom, for which SOR. */
const orderPart = (vm) => purchasing(vm);

/** 2 · Payments: what was paid, and the account it went to. */
function paymentsPart(vm) {
  return section(esc(ipasSectionLabel('finance')), '', `${paymentsTable(vm)}${bankBox(vm)}`);
}

/** 3 · Costs: the charges on top of the price, and the Landed Cost. */
function costsPart(vm) {
  return section(esc(ipasSectionLabel('costing')), `Charges: ${esc(vm.section3.chargesTotal)}`, `<div class="cols2"><div>${chargesTable(vm)}</div><div>${build(vm)}</div></div>${costing(vm)}`);
}

function sorsOf(vm) {
  const sors = vm.section2.sors;
  return sors.length
    ? `<table><thead><tr><th style="width:18%">SOR</th><th>Project</th></tr></thead><tbody>${sors
        .map((sor) => `<tr><td class="m" style="font-weight:600">${esc(sor.reference)}</td><td>${esc(sor.title ?? '—')}</td></tr>`)
        .join('')}</tbody></table>`
    : '';
}


function chargesTable(vm) {
  const s = vm.section3;
  return `<table><thead><tr><th>Importation charge</th><th style="width:30%">Date</th><th class="num" style="width:34%">Amount</th></tr></thead>
    <tbody>${
      s.freight ? `<tr><td>Freight${s.freight.service ? ` · ${esc(s.freight.service)}` : ''}</td><td></td><td class="num">${esc(s.freight.amount)}</td></tr>` : ''
    }${
      s.charges.length
        ? s.charges
            .map((c) => `<tr><td>${esc(c.kind)}</td><td class="m">${esc(c.date)}</td><td class="num">${esc(c.amount)}</td></tr>`)
            .join('')
        : '<tr><td colspan="3" class="empty">No charges recorded.</td></tr>'
    }</tbody>
    <tfoot><tr><td colspan="2" style="text-align:right">Total charges</td><td class="num">${esc(s.chargesTotal)}</td></tr></tfoot></table>`;
}

function bankBox(vm) {
  const s = vm.section3;
  // Bank details exist on paper only for someone who may read them.
  let bank = '';
  if (s.bank) {
    bank = s.bank.present
      ? `<div class="box"><div class="fields n3">
          ${field('Bank', esc(s.bank.bankName ?? '—'))}
          ${field('Account name', esc(s.bank.accountName ?? '—'))}
          ${field('Account #', esc(s.bank.accountNumber ?? '—'), {
            mono: true,
            note: s.bank.flagged ? '<span class="flag">Account # changed from the last IPAS</span>' : '',
          })}
        </div></div>`
      : '<div class="box empty">No bank details typed.</div>';
  }

  return bank;
}

function logistics(vm) {
  return section(
    esc(ipasSectionLabel('logistics')),
    vm.section6.hasOdooMarks ? legend : '',
    `<div class="fields n2">${field('Item Location', esc(vm.section5.itemLocation ?? '—'))}</div>${tg03Rows(vm.section5.tg03)}${status(vm)}`,
  );
}

/** Section 5's Transmittals (#256): number, date, priority, stage or state, NA count. */
function tg03Rows(slips = []) {
  if (slips.length === 0) return '';
  const rows = slips
    .map(
      (slip) =>
        `<tr><td>${esc(slip.number ?? '')}</td><td>${esc(slip.date ?? '')}</td><td>${esc(slip.priority ?? '')}</td><td>${esc(slip.stateLabel ?? '')}</td><td>${slip.naCount ? `${slip.naCount} NA` : ''}</td></tr>`,
    )
    .join('');
  return `<table class="transmittals"><thead><tr><th>TG03</th><th>Date</th><th>Priority</th><th>Stage / state</th><th>NA</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const statusChip = (item) =>
  `<span class="s${item.ticked ? ' done' : ''}">${tick(item.ticked, item.partial)}
    <span class="t">${esc(item.label)}</span>${item.stampedFromOdoo ? odooMark : ''}${
      item.detail ? `<span class="d">${esc(item.detail)}</span>` : ''
    }</span>`;

/** Supplier Origin (Import only) and the buyer track. */
function status(vm) {
  const s = vm.section6;

  const origin = s.origin
    ? `<div><div class="group-k">Supplier origin</div><div class="stat">${s.origin
        .map(
          (o) => `<span class="s${o.date ? ' done' : ''}">${tick(Boolean(o.date))}<span class="t">${esc(o.label)}</span>${
            o.date ? `<span class="d">${esc(o.date)}</span>` : ''
          }</span>`,
        )
        .join('')}</div></div>`
    : '';

  return `<div class="track">${origin}
    <div><div class="group-k">Buyer track</div><div class="stat">${s.buyerTrack.map(statusChip).join('')}</div></div></div>`;
}

/** The computation status and Landed Cost per line, with its provisional or final mark. */
function costing(vm) {
  const s = vm.section6;
  const lc = s.landedCost;
  const mark = `<span class="prov ${lc.status === 'final' ? 'final' : lc.status === 'unavailable' ? 'na' : ''}">${esc(lc.label)}</span>`;

  const t = s.landedTable;
  const cell = (v) => (v === null || v === undefined ? '—' : esc(v));
  const landed =
    lc.status === 'unavailable' || !t
      ? `<div class="sub">${esc(lc.note ?? '')}</div>`
      : `<table><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Duties</th><th class="num">Freight</th><th class="num">Other</th><th class="num">Landed / unit</th>${
          t.pricing ? '<th class="num">Retail</th><th class="num">Wholesale</th>' : ''
        }</tr></thead>
          <tbody>${t.rows
            .map(
              (r) => `<tr><td class="pre">${esc(r.name)}</td><td class="num">${esc(r.quantity)}</td><td class="num">${cell(r.unitPrice)}</td>
                <td class="num">${cell(r.duties)}</td><td class="num">${cell(r.freight)}</td><td class="num">${cell(r.other)}</td><td class="num">${cell(r.landed)}</td>${
                  t.pricing ? `<td class="num">${cell(r.retail)}</td><td class="num">${cell(r.wholesale)}</td>` : ''
                }</tr>`,
            )
            .join('')}</tbody></table>`;

  return `<div class="box"><div class="group-k">Landed cost ${mark}</div>${landed}</div>`;
}


// ── The document ─────────────────────────────────────────────────────────────

/** The documents of every part, as one list of ticks (5 · Documents). */
function documentsPart(vm) {
  const docs = [vm.section1.docs, vm.section3.docs, vm.section6.docs, vm.section7.docs].flat().filter(Boolean);
  const seen = new Set();
  const unique = docs.filter((d) => (seen.has(d.label) ? false : seen.add(d.label)));
  return section(esc(ipasSectionLabel('documents')), '', unique.length ? docTicks(unique) : '<div class="empty">No documents.</div>');
}

/**
 * The page in the record's order (2026-11-06): 1 Order, 2 Payments, 3 Costs,
 * 4 Delivery, 5 Documents, then 6 Sign-offs with every signature together, so
 * the signers sign the whole form, read top to bottom.
 */
export function buildIpasPagesHtml(vm) {
  const s1 = vm.section1;
  const s7 = vm.section7.signoffs;
  const as = (box, role) => (box ? { ...box, role } : null);
  const boxes = [
    as(s1.signoffs?.[0], 'Sent for signing'),
    as(s1.signoffs?.[1], 'Approved'),
    as(vm.section5.signoffs?.[0], 'Logistics'),
    as(s7?.[2], 'Checked'),
    as(s7?.[3], 'Approved and filed'),
  ].filter(Boolean);
  const parts = [
    orderPart(vm),
    paymentsPart(vm),
    costsPart(vm),
    logistics(vm),
    documentsPart(vm),
    section(esc(ipasSectionLabel('filing')), '', sigs(boxes)),
  ].join('');
  return `<div class="sheet dense">
    ${rail(vm)}${head(vm)}
    <div class="flow">${parts}</div>
    ${footer(vm)}
  </div>`;
}

/** The full printable document: the same HTML the browser prints and "Save as PDF" converts. */
export function buildIpasDocument(vm) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(vm.number)} · ${esc(vm.poNumber)}${vm.filingCopy ? ' · filing copy' : ''}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
<style>${CSS}</style>
</head>
<body>
${buildIpasPagesHtml(vm)}
</body>
</html>`;
}
