/**
 * The printed Canvass as HTML (spec #956, issue #971): landscape A4, one sheet per page, in the
 * shared paper set (rail, `.hdr` facts, `.sec` sections, the signature band). Lines go down,
 * suppliers go across three to a page, laid out like the PMS 3 CANVASS MATRIX tab; a fourth
 * supplier continues on the next page with the line column repeated. The winner of each line is
 * marked, the reasons are listed under the grid on the last page, and only "Canvassed by" signs.
 *
 * Pure: a view model (canvassViewModel.js) in, a document string out. It draws only what the view
 * model carries, so a reader without money gets no price, rate or total markup at all. Everything
 * typed goes through `escapeHtml`.
 */

import { MARK } from './brandMark';
import { PAPER_CSS, pageCss } from './paperSet';
import { escapeHtml as esc, sigBlock } from './sigBlock';
import { SUPPLIERS_PER_PAGE } from './canvassViewModel';

const EXTRA_CSS = `
  .sheet { width: 297mm; min-height: 209mm; }
  ${pageCss({ landscape: true })}
  .cnv-grid { table-layout: fixed; }
  .cnv-grid th, .cnv-grid td { border: 1px solid var(--rule); padding: 3px 5px; overflow-wrap: anywhere; }
  .cnv-grid thead { display: table-header-group; }
  .cnv-grid tr { break-inside: avoid; page-break-inside: avoid; }
  .cnv-grid thead th { color: var(--ink); font-weight: 600; }
  .cnv-grid .sub { display: block; font-weight: 400; color: var(--ink-faint); font-size: var(--t-fine); }
  .cnv-grid td.no { font-family: var(--mono); font-weight: 600; text-align: center; }
  .cnv-grid td.q { font-family: var(--mono); text-align: right; white-space: nowrap; }
  .cnv-grid .win { background: var(--wash); }
  .cnv-grid .none { color: var(--ink-faint); font-style: italic; }
  .cnv-grid .price { font-family: var(--mono); white-space: nowrap; }
  .cnv-reasons { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; font-size: var(--t-table); }
  .cnv-reasons .n { font-family: var(--mono); font-weight: 600; margin-right: 6px; }
  .cnv-reasons .off { color: var(--ink-faint); font-style: italic; }
  .cnv-note { font-size: var(--t-body); }
  .cnv-warning { font-size: var(--t-body); font-weight: 600; color: var(--flag); }
`;

const field = (label, value, { mono = false } = {}) =>
  `<div class="f"><span class="k">${esc(label)}</span><span class="v${mono ? ' mono' : ''}">${esc(value)}</span></div>`;

const sub = (value) => (value ? `<span class="sub">${esc(value)}</span>` : '');

function supplierHead(s) {
  const facts = [s.currency, s.rate].filter(Boolean).join(' · ');
  return `<th><b>${esc(s.name)}</b>${sub(facts)}${sub(s.holds)}${sub(`Lead time ${s.leadTime}`)}</th>`;
}

function cellHtml(cell) {
  if (cell.state === 'none') return '<td class="none">Not quoted</td>';
  const parts = [
    cell.brand ? `<b>${esc(cell.brand)}</b>` : '',
    cell.description ? esc(cell.description) : '',
    cell.remarks ? `<span class="sub">${esc(cell.remarks)}</span>` : '',
    cell.price !== undefined ? `<div class="price">${esc(cell.price)}<span class="sub">Total ${esc(cell.total)}</span></div>` : '',
    cell.winner ? '<span class="prov final">Winner</span>' : '',
  ].filter(Boolean);
  return `<td class="${cell.winner ? 'win' : ''}">${parts.join('<br>')}</td>`;
}

/** The grid of one page: the line column, then up to three suppliers; short pages keep the column count. */
function gridHtml(page) {
  const pad = Math.max(0, SUPPLIERS_PER_PAGE - page.suppliers.length);
  const head = `<thead><tr><th style="width:4%">No.</th><th style="width:22%">Asked for</th><th style="width:5%">Qty</th><th style="width:5%">Unit</th>${page.suppliers
    .map(supplierHead)
    .join('')}${'<th></th>'.repeat(pad)}</tr></thead>`;
  const body = page.rows
    .map(
      (row) =>
        `<tr><td class="no">${row.no}</td><td>${row.brand ? `<b>${esc(row.brand)}</b><br>` : ''}${esc(row.description)}</td><td class="q">${esc(row.quantity)}</td><td>${esc(row.unit)}</td>${row.cells
          .map(cellHtml)
          .join('')}${'<td></td>'.repeat(pad)}</tr>`,
    )
    .join('');
  const empty = page.rows.length === 0 ? '<div class="empty">No lines on this request.</div>' : '';
  return `<table class="cnv-grid">${head}<tbody>${body}</tbody></table>${empty}`;
}

const OUTCOME_TEXT = { 'no-winner': 'No winner chosen', unquoted: 'No supplier quoted' };

function reasonsHtml(vm) {
  const items = vm.reasons
    .map((r) => {
      const body =
        r.outcome === 'won'
          ? `<b>${esc(r.supplier)}</b> — ${r.reason ? esc(r.reason) : '<span class="off">no reason recorded</span>'}`
          : `<span class="off">${OUTCOME_TEXT[r.outcome]}</span>`;
      return `<li data-testid="print-reason-${r.no}"><span class="n">${r.no}</span>${body}</li>`;
    })
    .join('');
  const note = vm.noOtherSupplier
    ? `<div class="cnv-note" data-testid="print-no-other"><b>No other supplier:</b> ${esc(vm.noOtherSupplier.reason)}${vm.noOtherSupplier.by ? ` <span class="off">${esc(vm.noOtherSupplier.by)}</span>` : ''}</div>`
    : '';
  const warning = vm.warning ? `<div class="cnv-warning" data-testid="more-offers-warning">${esc(vm.warning)}</div>` : '';
  return `<section class="sec"><h3><span>Winners and reasons</span></h3><div class="body">${items ? `<ul class="cnv-reasons">${items}</ul>` : '<div class="empty">No lines.</div>'}${note}${warning}</div></section>`;
}

function bandHtml(blocks) {
  return `<div class="band"><div class="sigs n${blocks.length}">${blocks
    .map((b) =>
      sigBlock({
        role: esc(b.role),
        who: esc(b.who),
        title: esc(b.title),
        state: b.state,
        stamp: b.stamp ? esc(b.stamp) : undefined,
        signatureBase64: b.signatureBase64 ? esc(b.signatureBase64) : undefined,
      }),
    )
    .join('')}</div></div>`;
}

function pageHtml(vm, page) {
  const h = vm.header;
  const last = page.number === page.of;
  const forWhom = [h.client, h.project].filter(Boolean).join(' · ');
  return `<div class="sheet" data-testid="canvass-page-${page.number}">
    <div class="rail"><span class="mark">${MARK}</span>
      <span class="org"><b>T3CKGROUP</b>Purchasing department</span>
      <span class="doc"><div class="t">${esc(vm.number)}</div><div class="s">Canvass${page.of > 1 ? ` · Page ${page.number} of ${page.of}` : ''}</div></span></div>
    <div class="hdr">
      ${field('Purchase Request', h.request)}
      ${field('Client · Project', forWhom || '—')}
      ${field('Date', h.date ?? '—')}
      ${field('Canvassed by', vm.signatures[0].who || '—')}
      ${h.sor ? field('SOR', h.sor, { mono: true }) : ''}
      ${field('Suppliers', String(h.supplierCount), { mono: true })}
    </div>
    <section class="sec"><h3><span>Canvass</span><b>${h.lineCount} ${h.lineCount === 1 ? 'line' : 'lines'}</b></h3><div class="body">${gridHtml(page)}</div></section>
    ${last ? reasonsHtml(vm) : ''}
    ${last ? bandHtml(vm.signatures) : ''}
    <div class="foot"><span>${esc(vm.number)}</span><span class="mid">${vm.printedOn ? `Printed ${esc(vm.printedOn)}${vm.printedBy ? ` by ${esc(vm.printedBy)}` : ''}` : ''}</span><span class="r">Purchasing</span></div>
  </div>`;
}

/** Every page as markup, one `.sheet` each. */
export function buildCanvassSheetHtml(vm) {
  return vm.pages.map((page) => pageHtml(vm, page)).join('\n');
}

/** The full printable document: the same HTML the browser prints and "Save as PDF" converts. */
export function buildCanvassDocument(vm) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(vm.number)} · Canvass</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
<style>${PAPER_CSS}${EXTRA_CSS}</style>
</head>
<body>
${buildCanvassSheetHtml(vm)}
</body>
</html>`;
}
