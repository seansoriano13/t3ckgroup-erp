/**
 * The printed IPAS as HTML: two A4 portrait pages in the sheet's own order
 * (spec #241 "Printed IPAS", issue #250, ADR 0014).
 *
 *   Page 1   header, 1 Purchasing (items and payments), 2 Sales & Operation,
 *            3 Purchasing & Finance (charges, documents, bank details)
 *   Page 2   5 Logistics (Item Location), 6 Status and Landed Cost,
 *            7 Filing (checklist and four signatures)
 *
 * There is no section 4 and no Transmittals list yet (they join in build step 2).
 *
 * Pure: a view model (ipasViewModel.js) in, a complete document string out.
 * `formHTML` and `sigBlock` concatenate strings without escaping, and an IPAS
 * carries text from Odoo and from people, so everything here goes through
 * `escapeHtml` before it is written, including what `sigBlock` is handed.
 */

import { MARK } from './brandMark';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const PAGE_COUNT = 2;

const CSS = `
  :root {
    --paper: #ffffff; --ink: #0f172a; --ink-mid: #1e293b; --ink-soft: #334155; --ink-faint: #64748b;
    --rule: #cbd5e1; --hair: #e2e8f0; --wash: #f8fafc;
    --accent: #0f5b47; --ok: #15803d; --ok-bg: #f0fdf4; --ok-border: #bbf7d0;
    --flag: #b91c1c; --warn: #b45309; --warn-bg: #fffbeb; --warn-border: #fde68a;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
    --serif: "Spectral", ui-serif, Georgia, "Times New Roman", serif;
  }
  * { box-sizing: border-box; }
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: var(--ink); font-family: var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .sheet {
    width: 210mm; min-height: 296mm; margin: 0 auto; padding: 9mm 12mm 8mm;
    display: flex; flex-direction: column; gap: 3mm;
    font-size: 8.6pt; line-height: 1.34; color: var(--ink); background: var(--paper);
  }
  .sheet.first { break-after: page; page-break-after: always; }

  .m { font-family: var(--mono); }
  .rail { display: flex; align-items: flex-end; gap: 12px; border-bottom: 2px solid var(--ink); padding-bottom: 8px; }
  .rail .mark { width: 24px; height: 21px; color: var(--accent); flex: none; }
  .rail .mark svg { width: 100%; height: 100%; display: block; }
  .rail .org { font-size: 7.4pt; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); line-height: 1.25; font-weight: 500; }
  .rail .org b { display: block; font-size: 10.5pt; letter-spacing: .04em; color: var(--ink); font-weight: 700; }
  .rail .doc { margin-left: auto; text-align: right; }
  .rail .doc .t { font-family: var(--serif); font-size: 16pt; font-weight: 600; line-height: 1; }
  .rail .doc .s { font-family: var(--mono); font-size: 7.5pt; color: var(--ink-soft); font-weight: 500; margin-top: 3px; }
  .copy-mark { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid var(--ink); border-radius: 2px; font-family: var(--sans); font-size: 6.4pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink); }

  .hdr { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px 14px; border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair); padding: 9px 2px; }
  .f .k { display: block; font-size: 6.5pt; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; margin-bottom: 2px; }
  .f .v { font-size: 9pt; font-weight: 600; overflow-wrap: anywhere; }
  .f .v.mono { font-family: var(--mono); font-weight: 500; }
  .f .x { display: block; font-size: 6.8pt; color: var(--ink-faint); font-weight: 400; }
  .tag-state { display: inline-block; padding: 1px 6px; border-radius: 3px; background: var(--wash); border: 1px solid var(--hair); font-size: 7pt; font-weight: 600; }
  .tag-state.filed { background: var(--ok-bg); border-color: var(--ok-border); color: var(--ok); }
  .tag-state.cancelled { color: var(--flag); }

  .sec { display: flex; flex-direction: column; gap: 5px; }
  .sec > h3 { margin: 0; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 7.6pt; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-mid); border-bottom: 1.5px solid var(--hair); padding: 0 0 5px; font-weight: 700; }
  .sec > h3 b { font-family: var(--mono); color: var(--ink-soft); font-weight: 500; letter-spacing: 0; font-size: 7.2pt; background: var(--wash); border-radius: 3px; padding: 1px 7px; text-transform: none; }
  .sec > .body { padding: 2px 0; display: flex; flex-direction: column; gap: 6px; }
  .cols2 { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(32mm, 1fr)); gap: 5px 14px; }
  .fields.n3 { grid-template-columns: repeat(3, 1fr); }
  .fields.n2 { grid-template-columns: repeat(2, 1fr); }

  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; vertical-align: top; padding: 3px 6px; border-bottom: 1px solid var(--hair); font-size: 8pt; }
  thead th { font-size: 6.4pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); font-weight: 700; border-bottom: 1.5px solid var(--rule); padding: 4px 6px; }
  th.num, td.num { text-align: right; font-family: var(--mono); white-space: nowrap; }
  th.center, td.center { text-align: center; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  tfoot td { font-weight: 700; border-top: 1.5px solid var(--rule); border-bottom: 0; padding: 5px 6px; }
  .pre { white-space: pre-line; }
  .sub { color: var(--ink-soft); font-size: 7pt; }
  .empty { color: var(--ink-faint); font-style: italic; }

  .chk { display: inline-flex; align-items: center; justify-content: center; width: 12px; height: 12px; border-radius: 2px; border: 1px solid var(--ink-faint); background: #ffffff; font-size: 8pt; line-height: 1; color: transparent; vertical-align: middle; }
  .chk.done { background: var(--ok-bg); border-color: var(--ok); color: var(--ok); font-weight: 700; }
  .chk.part { border-color: var(--warn); color: var(--warn); font-weight: 700; }

  .stat { display: flex; flex-wrap: wrap; gap: 4px 8px; }
  .stat .s { display: inline-flex; gap: 5px; align-items: center; padding: 2px 7px; border-radius: 4px; border: 1px solid var(--hair); font-size: 7.6pt; break-inside: avoid; }
  .stat .s.done { background: var(--ok-bg); border-color: var(--ok-border); font-weight: 600; }
  .stat .s .d { font-family: var(--mono); color: var(--ink-soft); font-size: 6.8pt; font-weight: 500; }
  .stat .s.current { border-color: var(--ink); }
  .odoo { color: var(--accent); font-size: 7pt; line-height: 1; }
  .legend { color: var(--accent); font-family: var(--sans); font-weight: 600; }
  .group-k { font-size: 6.5pt; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint); font-weight: 700; margin-bottom: 3px; }

  .box { border: 1px solid var(--rule); border-radius: 4px; padding: 6px 8px; background: var(--wash); break-inside: avoid; }
  .prov { display: inline-block; padding: 0 5px; font-size: 6.8pt; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-radius: 2.5px; border: 1px solid var(--warn-border); background: var(--warn-bg); color: var(--warn); }
  .prov.final { border-color: var(--ok-border); background: var(--ok-bg); color: var(--ok); }
  .prov.na { border-color: var(--rule); background: #ffffff; color: var(--ink-soft); }
  .flag { color: var(--flag); font-weight: 700; }

  .sigs { display: grid; gap: 6mm; margin-top: 1mm; break-inside: avoid; }
  .sigs.n2 { grid-template-columns: repeat(2, 1fr); }
  .sigs.n4 { grid-template-columns: repeat(4, 1fr); }
  .sig { display: flex; flex-direction: column; }
  .sig .k { font-size: 6.4pt; letter-spacing: .09em; text-transform: uppercase; color: var(--ink-faint); font-weight: 700; }
  .sig .plate { height: 9mm; border-bottom: 1.2px solid var(--ink); display: flex; align-items: flex-end; padding-bottom: 3px; margin-top: 4px; }
  .sig.awaiting .plate { border-bottom-style: dashed; border-bottom-color: var(--ink-faint); }
  .sig .plate img { max-height: 8mm; max-width: 100%; object-fit: contain; }
  .sig .printed-name { font-family: var(--serif); font-style: italic; font-size: 11pt; font-weight: 600; }
  .sig .who { font-size: 8.2pt; font-weight: 600; margin-top: 4px; min-height: 1.34em; }
  .sig .role { font-size: 6.8pt; color: var(--ink-soft); }
  .sig .stamp { font-family: var(--mono); font-size: 6.2pt; color: var(--ink-faint); margin-top: 1px; }
  .sig .pending { font-family: var(--mono); font-size: 6.4pt; color: var(--warn); font-weight: 700; letter-spacing: .1em; text-transform: uppercase; margin-top: 1px; }

  .foot { display: grid; grid-template-columns: 1fr 1.6fr 1fr; align-items: start; gap: 12px; border-top: 1px solid var(--hair); padding-top: 4px; font-size: 6.6pt; color: var(--ink-faint); font-family: var(--mono); margin-top: auto; }
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
  const stateClass = vm.filed ? ' filed' : vm.state === 'cancelled' ? ' cancelled' : '';
  return `<div class="rail"><span class="mark">${MARK}</span>
    <span class="org"><b>T3CKGROUP</b>Integrated Purchasing and Shipping Form</span>
    <span class="doc"><div class="t">IPAS${vm.filingCopy ? '<span class="copy-mark">Filing copy</span>' : ''}</div>
    <div class="s">${esc(vm.number)} · ${esc(vm.poNumber)} · page ${page} of ${PAGE_COUNT}</div>
    <div class="s"><span class="tag-state${stateClass}">${esc(vm.stateLabel)}</span></div></span></div>`;
}

function header(vm) {
  const h = vm.header;
  return `<div class="hdr">
    ${field('Entity', overridableValue(h.entity), { note: overrideNote(h.entity) })}
    ${field('Priority', esc(h.priority))}
    ${field('Source', esc(h.source))}
    ${field('Purpose', esc(h.purpose))}
    ${field('Date created', esc(h.created), { mono: true })}
    ${field('Created by', esc(h.createdBy))}
  </div>`;
}

function footer(vm, page, sections) {
  const f = vm.footer;
  const middle = [f.landedCost, f.odooRead + (f.odooNote ? ` (${f.odooNote})` : '')].filter(Boolean).map(esc).join(' · ');
  return `<div class="foot">
    <span>${esc(f.reference)}${f.printed ? `<br>${esc(f.printed)}` : ''}</span>
    <span class="mid">${middle}</span>
    <span class="r">page ${page} of ${PAGE_COUNT}<br>${esc(sections)}</span>
  </div>`;
}

// ── Sections ─────────────────────────────────────────────────────────────────

function section1(vm) {
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
    '1 · Purchasing',
    esc(s.poNumber),
    `<div class="fields">
      ${field('Supplier', esc(s.supplier))}
      ${field('Contact', esc(s.contact ?? '—'))}
      ${field('Currency', esc(s.currency), { mono: true })}
      ${field('P.I #', esc(s.piNumber ?? '—'), { mono: true })}
      ${s.piQtAmount ? field('P.I/QT Amount', esc(s.piQtAmount), { mono: true }) : ''}
    </div>
    ${items}
    ${payments}
    ${sigs(s.signoffs, 2)}`,
  );
}

function section2(vm) {
  const s = vm.section2;
  const sors = s.sors.length
    ? `<table><thead><tr><th style="width:18%">SOR</th><th>Project</th></tr></thead><tbody>${s.sors
        .map(
          (sor) => `<tr><td class="m" style="font-weight:600">${esc(sor.reference)}</td><td>${esc(sor.title ?? '—')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<div class="empty">No SOR named.</div>';

  return section(
    '2 · Sales &amp; Operation',
    '',
    `${sors}
    <div class="fields n2">
      ${field('Source Doc. Odoo', overridableValue(s.sourceDoc), { mono: true, note: overrideNote(s.sourceDoc) })}
      ${field('Analytic Dist.', overridableValue(s.analytic), { note: overrideNote(s.analytic) })}
    </div>`,
  );
}

function section3(vm) {
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
    '3 · Purchasing &amp; Finance',
    `Charges: ${esc(s.chargesTotal)}`,
    `<div class="cols2"><div>${charges}</div><div>${documents}</div></div>
    ${bank}
    ${sigs(s.signoffs, 2)}`,
  );
}

function section5(vm) {
  return section(
    '5 · Logistics &amp; Warehouse',
    '',
    `<div class="fields n2">${field('Item Location', esc(vm.section5.itemLocation ?? '—'))}</div>`,
  );
}

const statusChip = (item) =>
  `<span class="s${item.ticked ? ' done' : ''}">${tick(item.ticked, item.partial)}
    <span class="t">${esc(item.label)}</span>${item.stampedFromOdoo ? odooMark : ''}${
      item.detail ? `<span class="d">${esc(item.detail)}</span>` : ''
    }</span>`;

function section6(vm) {
  const s = vm.section6;
  const lc = s.landedCost;
  const mark = `<span class="prov ${lc.status === 'final' ? 'final' : lc.status === 'unavailable' ? 'na' : ''}">${esc(lc.label)}</span>`;

  const origin = s.origin
    ? `<div><div class="group-k">Supplier origin</div><div class="stat">${s.origin
        .map(
          (o) => `<span class="s${o.date ? ' done' : ''}">${tick(Boolean(o.date))}<span class="t">${esc(o.label)}</span>${
            o.date ? `<span class="d">${esc(o.date)}</span>` : ''
          }</span>`,
        )
        .join('')}</div></div>`
    : '';

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
    '6 · Status',
    s.hasOdooMarks ? legend : '',
    `${origin}
    <div><div class="group-k">Buyer track</div><div class="stat">${s.buyerTrack.map(statusChip).join('')}</div></div>
    ${computation}
    <div class="box"><div class="group-k">Landed cost calculation ${mark}</div>${landed}</div>`,
  );
}

function section7(vm) {
  const s = vm.section7;
  return section(
    '7 · For filing',
    'Finance',
    `<div class="stat">${s.checklist
      .map(
        (c) => `<span class="s${c.ticked ? ' done' : ''}">${tick(c.ticked)}<span class="t">${esc(c.label)}</span>${
          c.detail ? `<span class="d">${esc(c.detail)}</span>` : ''
        }</span>`,
      )
      .join('')}</div>
    ${sigs(s.signoffs, 4)}`,
  );
}

// ── The document ─────────────────────────────────────────────────────────────

/** Both pages, as markup. */
export function buildIpasPagesHtml(vm) {
  return `<div class="sheet first">
    ${rail(vm, 1)}${header(vm)}${section1(vm)}${section2(vm)}${section3(vm)}
    ${footer(vm, 1, 'sections 1–3')}
  </div>
  <div class="sheet">
    ${rail(vm, 2)}${section5(vm)}${section6(vm)}${section7(vm)}
    ${footer(vm, 2, 'sections 5–7')}
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,600;1,400;1,600&display=swap">
<style>${CSS}</style>
</head>
<body>
${buildIpasPagesHtml(vm)}
</body>
</html>`;
}
