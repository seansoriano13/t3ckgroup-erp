/**
 * The printed IPAS as HTML: two A4 portrait pages (spec #241 "Printed IPAS",
 * issue #250, ADR 0014), drawn in the same document language as the HR leave
 * slips (htmlPrinter.js): rail, serif name, one big mono figure, a right-hand
 * Outcome column, hairlines and a signature band.
 *
 *   Page 1   the voucher: supplier and the Landed Cost, how that figure is
 *            built, the header fields, Outcome and sign-offs, and every
 *            signature box of sections 1, 3 and 7
 *   Page 2   the reference, numbered and named as the screen numbers them
 *            (ipasSectionLabel, constants/ipas.js): 1 Purchasing (items and
 *            payments), 2 Purchasing & Finance (charges, documents, bank
 *            details), 3 Computation status & Landed Cost, 4 Filing, 5 Sales &
 *            Operation, 6 Logistics, 7 Status
 *
 * The view model keeps the stored section names (`section1`, `section3`, ...);
 * only what is printed is renumbered. There is no Transmittals list yet.
 *
 * Pure: a view model (ipasViewModel.js) in, a complete document string out.
 * `formHTML` and `sigBlock` concatenate strings without escaping, and an IPAS
 * carries text from Odoo and from people, so everything here goes through
 * `escapeHtml` before it is written, including what `sigBlock` is handed.
 */

import { ipasSectionLabel } from '../../constants/ipas';
import { MARK } from './brandMark';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const PAGE_COUNT = 2;

export const CSS = `
  :root {
    --paper: #ffffff; --ink: #221F1A; --ink-mid: #4A463F; --ink-soft: #4A463F; --ink-faint: #6E6A61;
    --rule: #C6C1B8; --hair: #E3E0D9; --wash: #F2F0EA;
    --accent: #221F1A; --ok: #221F1A; --ok-bg: #ffffff; --ok-border: #221F1A;
    --flag: #b91c1c; --warn: #6E6A61; --warn-bg: #ffffff; --warn-border: #6E6A61;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
    --serif: "Spectral", ui-serif, Georgia, "Times New Roman", serif;
  }
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: var(--ink); font-family: var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .sheet {
    width: 210mm; min-height: 296mm; margin: 0 auto; padding: 10mm 14mm 8mm;
    display: flex; flex-direction: column; gap: 3.5mm;
    font-size: 8.6pt; line-height: 1.36; color: var(--ink); background: var(--paper);
  }
  .sheet.first { break-after: page; page-break-after: always; }

  .m { font-family: var(--mono); font-variant-numeric: tabular-nums; }
  .k { font-size: 6pt; line-height: 1.3; font-weight: 500; letter-spacing: .155em; text-transform: uppercase; color: var(--ink-faint); }

  .rail { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--rule); }
  .rail .mark { width: 27px; height: 23px; flex: none; color: var(--ink); }
  .rail .mark svg { width: 100%; height: 100%; display: block; }
  .rail .org { font-size: 6pt; letter-spacing: .2em; text-transform: uppercase; color: var(--ink-faint); line-height: 1.55; font-weight: 500; }
  .rail .org b { display: block; font-size: 7.4pt; letter-spacing: .155em; color: var(--ink-mid); font-weight: 600; }
  .rail .doc { margin-left: auto; text-align: right; line-height: 1.45; }
  .rail .doc .t { font-size: 10pt; font-weight: 600; letter-spacing: .03em; font-family: var(--mono); }
  .rail .doc .s { font-family: var(--mono); font-size: 7pt; color: var(--ink-faint); }
  .copy-mark { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--ink); border-radius: 2px; font-family: var(--sans); font-size: 6pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink); }
  .tag-state { display: inline-block; padding: 0 5px; border: 1px solid var(--rule); border-radius: 2px; font-family: var(--sans); font-size: 6.4pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .tag-state.filed { border-color: var(--ink); color: var(--ink); }
  .tag-state.cancelled { color: var(--flag); border-color: var(--flag); }

  .head { display: flex; align-items: flex-end; gap: 28px; padding: 3mm 0 3.5mm; border-bottom: 1px solid var(--rule); }
  .head .l { flex: 1 1 auto; min-width: 0; }
  .head .kind { font-size: 7.8pt; font-weight: 600; letter-spacing: .19em; text-transform: uppercase; }
  .head .who { font-family: var(--serif); font-size: 19pt; font-weight: 500; letter-spacing: -.017em; line-height: 1.12; margin-top: 7px; overflow-wrap: anywhere; }
  .head .meta { font-size: 8pt; color: var(--ink-mid); margin-top: 4px; }
  .head .company { font-size: 7.2pt; color: var(--ink-faint); margin-top: 4px; }
  .head .company .k { display: inline; margin-right: 5px; }
  .head .company b { font-family: var(--mono); color: var(--ink); font-weight: 600; }
  .head .r { flex: 0 0 auto; text-align: right; }
  .head .big { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 23pt; font-weight: 500; letter-spacing: -.035em; line-height: 1; margin-top: 7px; }
  .head .big em { font-style: normal; font-size: 9pt; font-weight: 400; color: var(--ink-mid); margin-left: 6px; letter-spacing: 0; }
  .head .big.na { font-size: 13pt; color: var(--ink-faint); letter-spacing: 0; }
  .head .ledger { font-family: var(--mono); font-size: 7.2pt; color: var(--ink-faint); margin-top: 6px; }

  .cols { display: flex; gap: 24px; flex: 1; min-height: 0; padding-top: 1mm; }
  .cL { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5mm; }
  .cR { flex: 0 0 56mm; padding-left: 20px; border-left: 1px solid var(--hair); display: flex; flex-direction: column; gap: 5mm; }
  .blk .v { font-size: 9pt; font-weight: 600; margin-top: 4px; }
  .blk .rows { margin-top: 6px; display: grid; gap: 5px; }
  .blk .row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 7.6pt; line-height: 1.3; }
  .blk .row .a { color: var(--ink-faint); }
  .blk .row .b { font-family: var(--mono); font-weight: 500; text-align: right; }
  .blk .row .b.wait { color: var(--ink-faint); }

  .hdr { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 20px; }
  .f .k { display: block; margin-bottom: 2px; }
  .f .v { font-size: 9pt; font-weight: 500; overflow-wrap: anywhere; }
  .f .v.mono { font-family: var(--mono); font-size: 8.4pt; }
  .f .x { display: block; font-size: 6.8pt; color: var(--ink-faint); font-weight: 400; }

  .sec { display: flex; flex-direction: column; gap: 5px; }
  .sec > h3 { margin: 0; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; font-size: 6pt; letter-spacing: .155em; text-transform: uppercase; color: var(--ink-mid); border-bottom: 1px solid var(--rule); padding: 0 0 4px; font-weight: 600; }
  .sec > h3 b { font-family: var(--mono); color: var(--ink-faint); font-weight: 400; letter-spacing: 0; font-size: 7pt; text-transform: none; }
  .sec > .body { padding: 2px 0; display: flex; flex-direction: column; gap: 7px; }
  .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(32mm, 1fr)); gap: 6px 16px; }
  .fields.n3 { grid-template-columns: repeat(3, 1fr); }
  .fields.n2 { grid-template-columns: repeat(2, 1fr); }

  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; vertical-align: top; padding: 3px 6px 3px 0; border-bottom: 1px solid var(--hair); font-size: 8pt; }
  thead th { font-size: 6pt; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); font-weight: 500; border-bottom: 1px solid var(--rule); padding: 0 6px 4px 0; }
  th.num, td.num { text-align: right; font-family: var(--mono); white-space: nowrap; padding-right: 0; padding-left: 8px; }
  th.center, td.center { text-align: center; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tfoot td { font-weight: 600; border-top: 1px solid var(--ink); border-bottom: 0; padding: 5px 6px 0 0; }
  tfoot td.num { padding-right: 0; }
  .pre { white-space: pre-line; }
  .sub { color: var(--ink-mid); font-size: 7pt; }
  .empty { color: var(--ink-faint); font-style: italic; }

  .build td .basis { color: var(--ink-faint); font-size: 7.2pt; }
  .build tfoot td { font-family: var(--mono); font-size: 9.6pt; padding-top: 6px; }
  .build tfoot td:first-child { font-family: var(--sans); font-size: 8pt; }
  .lede { font-family: var(--serif); font-style: italic; font-size: 9.6pt; line-height: 1.5; color: var(--ink-mid); }

  .chk { display: inline-flex; align-items: center; justify-content: center; width: 11px; height: 11px; border-radius: 2px; border: 1px solid var(--ink-faint); background: #ffffff; font-size: 7.6pt; line-height: 1; color: transparent; vertical-align: middle; }
  .chk.done { border-color: var(--ink); color: var(--ink); font-weight: 700; }
  .chk.part { border-color: var(--ink-faint); color: var(--ink-mid); font-weight: 700; }

  .stat { display: flex; flex-wrap: wrap; gap: 4px 14px; }
  .stat .s { display: inline-flex; gap: 5px; align-items: center; font-size: 7.8pt; break-inside: avoid; color: var(--ink-faint); }
  .stat .s.done { color: var(--ink); font-weight: 500; }
  .stat .s .d { font-family: var(--mono); color: var(--ink-faint); font-size: 6.8pt; font-weight: 400; }
  .stat .s.current .t { text-decoration: underline; text-underline-offset: 2px; }
  .odoo { color: var(--ink); font-size: 6.6pt; line-height: 1; }
  .legend { color: var(--ink-mid); font-family: var(--sans); font-weight: 500; letter-spacing: 0; }
  .group-k { font-size: 6pt; letter-spacing: .155em; text-transform: uppercase; color: var(--ink-faint); font-weight: 500; margin-bottom: 3px; }

  .box { border-top: 1px solid var(--hair); padding: 6px 0 0; break-inside: avoid; }
  .prov { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--ink); border-radius: 2px; font-family: var(--sans); font-size: 5.8pt; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; vertical-align: 2px; color: var(--ink); }
  .prov.final { background: var(--ink); color: #ffffff; }
  .prov.na { border-color: var(--rule); color: var(--ink-faint); }
  .flag { color: var(--flag); font-weight: 700; }

  .band { margin-top: auto; padding-top: 4mm; border-top: 1px solid var(--rule); break-inside: avoid; }
  .sigs { display: grid; gap: 14px 20px; }
  .sigs.n2 { grid-template-columns: repeat(2, 1fr); }
  .sigs.n4 { grid-template-columns: repeat(4, 1fr); }
  .sig { display: flex; flex-direction: column; }
  .sig .k { color: var(--ink-faint); }
  .sig .plate { height: 9mm; margin-top: 4px; border-bottom: 1px solid var(--rule); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 2px; }
  .sig.awaiting .plate { background: var(--wash); }
  .sig .plate img { max-height: 8mm; max-width: 100%; object-fit: contain; }
  .sig .printed-name { font-family: var(--serif); font-style: italic; font-size: 11.5pt; font-weight: 500; }
  .sig .who { font-size: 8pt; font-weight: 600; margin-top: 4px; min-height: 1.34em; }
  .sig .role { font-size: 6pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); margin-top: 2px; }
  .sig .stamp { font-family: var(--mono); font-size: 6pt; color: var(--ink-mid); margin-top: 3px; }
  .sig .pending { font-family: var(--mono); font-size: 6pt; color: var(--ink-faint); letter-spacing: .12em; text-transform: uppercase; margin-top: 3px; }

  .foot { display: grid; grid-template-columns: 1fr 1.6fr 1fr; align-items: start; gap: 12px; border-top: 1px solid var(--hair); padding-top: 4px; font-size: 6.2pt; color: var(--ink-faint); font-family: var(--mono); margin-top: auto; }
  .foot .mid { text-align: center; }
  .foot .r { text-align: right; }
`;

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
const overrideNote = ({ overridden, odoo }) => (overridden ? `overridden · Odoo: ${esc(odoo ?? 'blank')}` : '');

/** The signature boxes: every string escaped before `sigBlock` concatenates it. */
function sigs(boxes, columns) {
  const html = boxes
    .map((box) =>
      sigBlock({
        role: esc(box.role),
        who: esc(box.who),
        title: esc(box.title),
        state: box.state,
        stamp: box.stamp ? esc(box.stamp) : undefined,
        signatureBase64: box.signatureBase64 ? esc(box.signatureBase64) : undefined,
      }),
    )
    .join('');
  return `<div class="sigs n${columns}">${html}</div>`;
}

// ── Chrome ───────────────────────────────────────────────────────────────────

function rail(vm, page) {
  return `<div class="rail"><span class="mark">${MARK}</span>
    <span class="org"><b>T3CKGROUP</b>Purchasing department</span>
    <span class="doc"><div class="t">${esc(vm.number)}${vm.filingCopy ? '<span class="copy-mark">Filing copy</span>' : ''}</div>
    <div class="s">IPAS · page ${page} of ${PAGE_COUNT}</div></span></div>`;
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

/** Who has signed what, in a few rows, from the boxes that print below. */
function outcome(vm) {
  const given = (boxes) => boxes.filter((box) => box.state === 'signed').length;
  const row = (label, boxes) => {
    const done = given(boxes);
    const text = done === boxes.length ? 'signed' : `${done} of ${boxes.length}`;
    return `<div class="row"><span class="a">${esc(label)}</span><span class="b${done === boxes.length ? '' : ' wait'}">${text}</span></div>`;
  };
  const computation = vm.section6.computation
    .map(
      (c) =>
        `<div class="row"><span class="a">${esc(c.label)}</span><span class="b${c.reached ? '' : ' wait'}">${c.current ? 'now' : c.reached ? 'done' : 'open'}</span></div>`,
    )
    .join('');
  return `<div class="blk"><div class="k">Outcome</div><div class="v">${esc(vm.stateLabel)}</div></div>
    <div class="blk"><div class="k">Sign-offs</div><div class="rows">
      ${row(ipasSectionLabel('purchasing'), vm.section1.signoffs)}
      ${row(ipasSectionLabel('finance'), vm.section3.signoffs)}
      ${row(ipasSectionLabel('filing'), vm.section7.signoffs)}
    </div></div>
    <div class="blk"><div class="k">Computation</div><div class="rows">${computation}</div></div>`;
}

/** How the Landed Cost is made: the goods, then everything spread over them. */
function build(vm) {
  const lc = vm.section6.landedCost;
  if (lc.status === 'unavailable') {
    return `<div class="sec"><h3><span>How the Landed Cost is built</span></h3><div class="body"><div class="lede">${esc(lc.note ?? 'Landed Cost is not available yet.')}</div></div></div>`;
  }
  const rows = lc.build
    .map((r) => `<tr><td>${esc(r.label)}${r.basis ? ` <span class="basis">${esc(r.basis)}</span>` : ''}</td><td class="num">${esc(r.amount)}</td></tr>`)
    .join('');
  return `<div class="sec"><h3><span>How the Landed Cost is built</span><b>${esc(lc.label)}</b></h3><div class="body">
    <table class="build"><thead><tr><th>Component</th><th class="num">PHP</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Landed Cost, ${esc(lc.units)}</td><td class="num">${esc(lc.total)}</td></tr></tfoot></table>
    ${lc.note ? `<div class="lede">${esc(lc.note)}</div>` : ''}
  </div></div>`;
}

function header(vm) {
  const h = vm.header;
  const s = vm.section1;
  return `<div class="hdr">
    ${field('Priority', esc(h.priority))}
    ${field('Source', esc(h.source))}
    ${field('Purpose', esc(h.purpose))}
    ${field('Date created', esc(h.created), { mono: true })}
    ${field('Created by', esc(h.createdBy))}
    ${field("Supplier's name", esc(s.contact ?? '—'))}
  </div>`;
}

function footer(vm, page, rangeLabel) {
  const f = vm.footer;
  const middle = [f.landedCost, f.odooRead + (f.odooNote ? ` (${f.odooNote})` : '')].filter(Boolean).map(esc).join(' · ');
  return `<div class="foot">
    <span>${esc(f.reference)}${f.printed ? `<br>${esc(f.printed)}` : ''}</span>
    <span class="mid">${middle}</span>
    <span class="r">page ${page} of ${PAGE_COUNT}<br>${esc(rangeLabel)}</span>
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

  const payments = s.payments.length
    ? `<table><thead><tr>
        <th style="width:15%">Payment</th><th style="width:13%">Date</th><th class="num" style="width:17%">Amount</th>
        <th class="num" style="width:17%">PHP debited</th><th class="num" style="width:14%">Charge fee</th>
        <th style="width:16%">Method</th><th class="center" style="width:8%">Proof</th>
      </tr></thead><tbody>${s.payments
        .map(
          (p) => `<tr><td style="font-weight:600">${esc(p.kind)}</td><td class="m">${esc(p.date)}</td>
            <td class="num">${esc(p.amount)}</td><td class="num">${esc(p.phpDebited)}</td><td class="num">${esc(p.chargeFee)}</td>
            <td>${esc(p.method)}</td><td class="center">${tick(p.proofOfPayment)}</td></tr>`,
        )
        .join('')}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right">Total debited, including charge fees</td><td class="num">${esc(s.totalDebited)}</td><td colspan="3"></td></tr></tfoot></table>${
        s.missingPhp
          ? `<div class="sub flag">${s.missingPhp} ${s.missingPhp === 1 ? 'payment has' : 'payments have'} no PHP debited, so the total is short.</div>`
          : ''
      }`
    : '<div class="empty">No payments recorded.</div>';

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
    ${payments}`,
  );
}

function sales(vm) {
  const s = vm.section2;
  const sors = s.sors.length
    ? `<table><thead><tr><th style="width:18%">SOR</th><th>Project</th></tr></thead><tbody>${s.sors
        .map(
          (sor) => `<tr><td class="m" style="font-weight:600">${esc(sor.reference)}</td><td>${esc(sor.title ?? '—')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<div class="empty">No SOR named.</div>';

  return section(
    esc(ipasSectionLabel('sales')),
    '',
    `${sors}
    <div class="fields n2">
      ${field('Googlesheet', tick(s.googleSheet))}
      ${field('Gantt Chart', tick(s.ganttChart))}
      ${field('Source Doc. Odoo', overridableValue(s.sourceDoc), { mono: true, note: overrideNote(s.sourceDoc) })}
      ${field('Analytic Dist.', overridableValue(s.analytic), { note: overrideNote(s.analytic) })}
    </div>`,
  );
}

function finance(vm) {
  const s = vm.section3;
  const charges = `<table><thead><tr><th>Importation charge</th><th style="width:30%">Date</th><th class="num" style="width:34%">Amount</th></tr></thead>
    <tbody>${
      s.charges.length
        ? s.charges
            .map((c) => `<tr><td>${esc(c.kind)}</td><td class="m">${esc(c.date)}</td><td class="num">${esc(c.amount)}</td></tr>`)
            .join('')
        : '<tr><td colspan="3" class="empty">No charges recorded.</td></tr>'
    }</tbody>
    <tfoot><tr><td colspan="2" style="text-align:right">Total charges</td><td class="num">${esc(s.chargesTotal)}</td></tr></tfoot></table>`;

  const documents = `<table><thead><tr><th>Document</th><th class="center" style="width:24%">Purchasing</th><th class="center" style="width:24%">Finance</th></tr></thead>
    <tbody>${
      s.documents.length
        ? s.documents
            .map(
              (d) => `<tr><td>${esc(d.label)}</td><td class="center">${tick(d.purchasing)}</td><td class="center">${tick(d.finance)}</td></tr>`,
            )
            .join('')
        : '<tr><td colspan="3" class="empty">No documents listed.</td></tr>'
    }</tbody></table>`;

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

  return section(
    esc(ipasSectionLabel('finance')),
    `Charges: ${esc(s.chargesTotal)}`,
    `<div class="cols2"><div>${charges}</div><div>${documents}</div></div>
    ${bank}`,
  );
}

function logistics(vm) {
  return section(
    esc(ipasSectionLabel('logistics')),
    '',
    `<div class="fields n2">${field('Item Location', esc(vm.section5.itemLocation ?? '—'))}</div>${tg03Rows(vm.section5.tg03)}`,
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

  return section(
    esc(ipasSectionLabel('status')),
    s.hasOdooMarks ? legend : '',
    `${origin}
    <div><div class="group-k">Buyer track</div><div class="stat">${s.buyerTrack.map(statusChip).join('')}</div></div>`,
  );
}

/** The computation status and Landed Cost per line, with its provisional or final mark. */
function costing(vm) {
  const s = vm.section6;
  const lc = s.landedCost;
  const mark = `<span class="prov ${lc.status === 'final' ? 'final' : lc.status === 'unavailable' ? 'na' : ''}">${esc(lc.label)}</span>`;

  const computation = `<div><div class="group-k">IPAS computation</div><div class="stat">${s.computation
    .map(
      (c) => `<span class="s${c.reached ? ' done' : ''}${c.current ? ' current' : ''}">${tick(c.reached)}<span class="t">${esc(c.label)}</span></span>`,
    )
    .join('')}</div></div>`;

  const landed =
    lc.status === 'unavailable'
      ? `<div class="sub">${esc(lc.note ?? '')}</div>`
      : `<table><thead><tr><th>Item</th><th class="num" style="width:14%">Qty</th><th class="num" style="width:22%">Landed cost per unit</th><th class="num" style="width:22%">Landed cost total</th></tr></thead>
          <tbody>${lc.lines
            .map(
              (l) => `<tr><td class="pre">${esc(l.name)}</td><td class="num">${esc(l.quantity)}${l.unit ? ` ${esc(l.unit)}` : ''}</td>
                <td class="num">${esc(l.perUnit)}</td><td class="num">${esc(l.total)}</td></tr>`,
            )
            .join('')}</tbody>
          <tfoot><tr><td colspan="3" style="text-align:right">Total landed cost</td><td class="num">${esc(lc.total)}</td></tr></tfoot></table>
          ${lc.note ? `<div class="sub">${esc(lc.note)}</div>` : ''}`;

  return section(
    esc(ipasSectionLabel('costing')),
    '',
    `${computation}
    <div class="box"><div class="group-k">Landed cost calculation ${mark}</div>${landed}</div>`,
  );
}

function filing(vm) {
  const s = vm.section7;
  return section(
    esc(ipasSectionLabel('filing')),
    'Finance',
    `<div class="stat">${s.checklist
      .map(
        (c) => `<span class="s${c.ticked ? ' done' : ''}">${tick(c.ticked)}<span class="t">${esc(c.label)}</span>${
          c.detail ? `<span class="d">${esc(c.detail)}</span>` : ''
        }</span>`,
      )
      .join('')}</div>`,
  );
}

// ── The document ─────────────────────────────────────────────────────────────

/** Both pages, as markup. */
export function buildIpasPagesHtml(vm) {
  const boxes = [...vm.section1.signoffs, ...vm.section3.signoffs, ...vm.section7.signoffs];
  const first = ipasSectionLabel('purchasing');
  const last = ipasSectionLabel('status');
  return `<div class="sheet first">
    ${rail(vm, 1)}${head(vm)}
    <div class="cols">
      <div class="cL">${build(vm)}${header(vm)}</div>
      <div class="cR">${outcome(vm)}</div>
    </div>
    <div class="band">${sigs(boxes, 4)}</div>
    ${footer(vm, 1, 'Summary and sign-offs')}
  </div>
  <div class="sheet">
    ${rail(vm, 2)}${purchasing(vm)}${finance(vm)}${costing(vm)}${filing(vm)}${sales(vm)}${logistics(vm)}${status(vm)}
    ${footer(vm, 2, `Sections ${first} to ${last}`)}
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
