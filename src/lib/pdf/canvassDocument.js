/**
 * The printed Canvass as HTML (issue #282, spec #275, ADR 0014): one A4 portrait sheet in the IPAS
 * print's furniture (rail, serif name, hairlines, the signature band), so it reads as part of the
 * same Purchasing paper set. The recommendation leads (variant C of the prototype); every Offer is
 * compared beneath as evidence, suppliers side by side as columns and the details as rows (a
 * Canvass usually has three or more), four suppliers to a table; the signatures close the page.
 *
 * Pure: a view model (canvassViewModel.js) in, a document string out. Everything typed or read
 * from outside goes through `escapeHtml`.
 */

import { MARK } from './brandMark';
import { CSS } from './ipasDocument';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  .head .r .x { font-family: var(--mono); font-size: 7.2pt; color: var(--ink-faint); margin-top: 6px; }
  .cnv-reason { font-family: var(--serif); font-size: 9.6pt; line-height: 1.5; white-space: pre-wrap; margin: 0; }
  .cnv-compare { table-layout: fixed; width: 100%; page-break-inside: avoid; break-inside: avoid; }
  .cnv-compare + .cnv-group { margin-top: 10px; }
  .cnv-compare th, .cnv-compare td { vertical-align: top; overflow-wrap: anywhere; }
  .cnv-compare thead th { text-align: left; }
  .cnv-compare th.cnv-label { font-family: var(--mono); font-size: 6.8pt; font-weight: 500; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-faint); text-align: left; }
  .cnv-compare .chosen { background: rgba(0, 0, 0, .035); }
  .cnv-compare .sub { margin-top: 2px; }
  .cnv-compare td.num .sub { font-size: 6.6pt; color: var(--ink-faint); white-space: normal; }
  .cnv-group { font-family: var(--mono); font-size: 7pt; color: var(--ink-faint); margin: 2px 0 4px; }
  .sigs.n3 { grid-template-columns: repeat(3, 1fr); }
  .cnv-slots { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.6pt; }
  .cnv-slots th, .cnv-slots td { border: 1px solid var(--ink); padding: 4px 6px; text-align: left; vertical-align: top; }
  .cnv-slots th { font-size: 7.4pt; text-transform: uppercase; letter-spacing: .06em; }
  .cnv-slots .cnv-by { font-size: 7.4pt; opacity: .7; }
  .cnv-warning { font-size: 8.2pt; font-weight: 600; color: var(--flag); border-top: 1px solid var(--ink); padding-top: 5px; }
`;

const field = (label, value, { mono = false } = {}) =>
  `<div class="f"><span class="k">${esc(label)}</span><span class="v${mono ? ' mono' : ''}">${esc(value)}</span></div>`;

/** The head: the chosen supplier in the serif name slot, its unit price in the big-figure slot. */
function headHtml(d) {
  const price = d.price
    ? `<div class="k">Unit price</div><div class="big">${esc(d.price)}</div>${d.foreign ? `<div class="x">${esc(d.foreign)}</div>` : ''}`
    : '';
  return `<div class="head">
    <div class="l"><div class="kind">Canvass · Recommended</div>
      <div class="who">${esc(d.supplier)}</div>
      ${d.detail ? `<div class="meta">${esc(d.detail)}</div>` : ''}</div>
    <div class="r">${price}</div>
  </div>`;
}

/** The reason the winner was chosen, printed as the canvasser typed it. */
function reasonHtml(reason) {
  const body = reason ? `<p class="cnv-reason">${esc(reason)}</p>` : '<div class="empty">No reason recorded.</div>';
  return `<section class="sec"><h3><span>Why this supplier</span></h3><div class="body">${body}</div></section>`;
}

/**
 * The details compared, one row each, in the order a purchaser reads a comparison: what it is,
 * what it costs, how fast, how good, how long the quote holds, then the papers and notes.
 */
const COMPARE_ROWS = [
  { label: 'Offered', cell: (o) => esc(o.offered) },
  { label: 'Quoted', num: true, cell: (o) => esc(o.quoted) },
  { label: 'In PHP', num: true, cell: (o) => `${esc(o.php)}${o.foreign ? `<div class="sub">${esc(o.foreign)}</div>` : ''}` },
  { label: 'Lead time', cell: (o) => esc(o.leadTime) },
  { label: 'Quality', cell: (o) => esc(o.quality) },
  { label: 'Valid to', cell: (o) => esc(o.validUntil) },
  { label: 'Brochure', cell: (o) => (o.brochure ? esc(o.brochure) : '<span class="empty">None</span>') },
  { label: 'Remarks', cell: (o) => (o.remarks ? esc(o.remarks) : '<span class="empty">—</span>') },
];

/**
 * One comparison table: the suppliers as columns (the chosen one marked), the details as rows.
 * A short last group keeps the full column count, so its columns line up with the table above.
 */
function compareTable(group, perTable) {
  const pad = Math.max(0, perTable - group.offers.length);
  const blank = '<td class="cnv-pad"></td>'.repeat(pad);
  const width = `${(82 / perTable).toFixed(2)}%`;
  const head = group.offers
    .map(
      (o) => `<th class="${o.chosen ? 'chosen' : ''}" style="width:${width}"><b>${esc(o.supplier)}</b>${o.chosen ? ' <span class="prov final">Chosen</span>' : ''}${o.brand ? `<div class="sub">${esc(o.brand)}</div>` : ''}</th>`,
    )
    .join('');
  const rows = COMPARE_ROWS.map(
    (row) =>
      `<tr><th class="cnv-label" scope="row">${row.label}</th>${group.offers
        .map((o) => `<td class="${[row.num ? 'num' : '', o.chosen ? 'chosen' : ''].filter(Boolean).join(' ')}">${row.cell(o)}</td>`)
        .join('')}${blank}</tr>`,
  ).join('');
  return `${group.label ? `<div class="cnv-group">${esc(group.label)}</div>` : ''}<table class="cnv-compare"><thead><tr>
      <th class="cnv-label" style="width:18%"></th>${head}${'<th class="cnv-pad"></th>'.repeat(pad)}
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/** Every Offer side by side, the chosen one marked; past four suppliers the comparison continues below. */
function offersHtml(offers, groups) {
  const count = `${offers.length} ${offers.length === 1 ? 'offer' : 'offers'}`;
  if (offers.length === 0) {
    return `<section class="sec"><h3><span>Offers</span><b>${count}</b></h3><div class="body"><div class="empty">No offers recorded.</div></div></section>`;
  }
  const perTable = Math.max(...groups.map((g) => g.offers.length), 1);
  return `<section class="sec"><h3><span>Offers</span><b>${count}</b></h3><div class="body">
    ${groups.map((group) => compareTable(group, groups.length > 1 ? perTable : group.offers.length)).join('')}</div></section>`;
}

/** The three supplier slots, with the reason for each "No other supplier" (#721). */
function slotsHtml(slots) {
  if (slots.length === 0) return '';
  const cell = (s) =>
    `<td data-testid="print-slot-${s.slot}"><b>${esc(s.label)}</b>${s.reason ? `<div>${esc(s.reason)}</div>` : ''}${s.by ? `<div class="cnv-by">${esc(s.by)}</div>` : ''}</td>`;
  return `<section class="sec"><h3><span>Supplier slots</span><b>3</b></h3><div class="body"><table class="cnv-slots"><tr>${slots
    .map((s) => `<th>Supplier ${s.slot}</th>`)
    .join('')}</tr><tr>${slots.map(cell).join('')}</tr></table></div></section>`;
}

/** The three signature plates through `sigBlock`, in the band every Purchasing form closes with. */
function bandHtml(blocks) {
  return `<div class="band"><div class="sigs n3">${blocks
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

/** The whole sheet as markup, in the same furniture as the IPAS, Transmittal and Packing List. */
export function buildCanvassSheetHtml(vm) {
  const h = vm.header;
  const approved = vm.signatures[2]?.state === 'signed';
  return `<div class="sheet">
    <div class="rail"><span class="mark">${MARK}</span>
      <span class="org"><b>T3CKGROUP</b>Purchasing department</span>
      <span class="doc"><div class="t">${esc(vm.number)}</div><div class="s">Canvass · ${approved ? 'Approved' : 'Not approved'}</div></span></div>
    ${headHtml(vm.decision)}
    <div class="hdr">
      ${field(h.subjectKind === 'Component' ? 'SOR · Component' : h.subjectKind, h.subject)}
      ${field('Raised', h.raised)}
      ${field('Offers', String(h.offerCount), { mono: true })}
    </div>
    ${reasonHtml(vm.decision.reason)}
    ${slotsHtml(vm.slots ?? [])}
    ${offersHtml(vm.offers, vm.offerGroups ?? [{ offers: vm.offers, label: null }])}
    ${vm.warning ? `<div class="cnv-warning" data-testid="more-offers-warning">${esc(vm.warning)}</div>` : ''}
    ${bandHtml(vm.signatures)}
    <div class="foot"><span>${esc(vm.number)}</span><span class="mid">${vm.printedOn ? `Printed ${esc(vm.printedOn)}${vm.printedBy ? ` by ${esc(vm.printedBy)}` : ''}` : ''}</span><span class="r">Purchasing</span></div>
  </div>`;
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
<style>${CSS}${EXTRA_CSS}</style>
</head>
<body>
${buildCanvassSheetHtml(vm)}
</body>
</html>`;
}
