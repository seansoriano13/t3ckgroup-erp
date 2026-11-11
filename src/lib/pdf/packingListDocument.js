/**
 * The printed Packing List as HTML (issue #260, spec #251, ADR 0014): one A4
 * portrait sheet in the IPAS print's furniture (rail, serif name, hairlines,
 * the signature plate), so it reads as part of the same paper set.
 *
 *   Rail     T3CKGROUP mark, "Packing List", the PKL_ number
 *   Head     the customer, the SOR and project, and the box count
 *   Facts    SOR, Odoo delivery ref, created by, packed on
 *   Boxes    box by box: number, marks, seal number, gross weight, contents
 *   Footer   box count, total known weight, "N of M boxes weighed" when partial
 *   Band     Packed by (sigBlock: awaiting, name only, or not applied)
 *
 * Pure: a view model (packingListViewModel.js) in, a document string out.
 * Everything typed or read from Odoo goes through `escapeHtml`, including
 * what `sigBlock` is handed.
 */

import { MARK } from './brandMark';
import { PAPER_CSS as CSS } from './paperSet';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  .pkl-box { border-top: 1px solid var(--hair); padding-top: var(--s-2); break-inside: avoid; }
  .pkl-box:first-child { border-top: 0; padding-top: 0; }
  .pkl-box .bh { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; }
  .pkl-box .bh .n { font-size: var(--t-value); font-weight: 600; min-width: 16mm; }
  .pkl-box .bh .f { font-family: var(--mono); font-size: var(--t-table); color: var(--ink); }
  .pkl-box .bh .f b { font-family: var(--sans); font-size: var(--t-micro); letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); font-weight: 500; margin-right: 5px; }
  .pkl-box ul { margin: var(--s-1) 0 0; padding: 0 0 0 16mm; list-style: none; }
  .pkl-box li { display: flex; justify-content: space-between; gap: 10px; font-size: var(--t-table); padding: var(--cell-y) 0; border-top: 1px solid var(--hair); }
  .pkl-box li .q { font-family: var(--mono); white-space: nowrap; }
  .pkl-box .none { font-style: italic; color: var(--ink-faint); font-size: var(--t-table); margin: var(--s-1) 0 0 16mm; }
`;

const field = (label, value, { mono = false } = {}) =>
  `<div class="f"><span class="k">${esc(label)}</span><span class="v${mono ? ' mono' : ''}">${esc(value)}</span></div>`;

/** One box: its header line (number, marks, seal, weight) and its contents. */
function box(b) {
  const contents = b.contents.length
    ? `<ul>${b.contents
        .map((c) => `<li><span>${esc(c.description)}</span><span class="q">${esc(c.quantity)}</span></li>`)
        .join('')}</ul>`
    : '<div class="none">No contents</div>';
  return `<div class="pkl-box">
    <div class="bh"><span class="n">Box ${esc(b.boxNo)}</span>
      <span class="f"><b>Marks</b>${esc(b.marks)}</span>
      <span class="f"><b>Seal</b>${esc(b.sealNo)}</span>
      <span class="f"><b>Gross</b>${esc(b.weight)}</span></div>
    ${contents}
  </div>`;
}

/** The whole sheet, as markup. */
export function buildPackingListSheetHtml(vm) {
  const sig = vm.signature;
  const t = vm.totals;
  const boxes = vm.boxes.length ? vm.boxes.map(box).join('') : '<div class="empty">No boxes packed.</div>';
  return `<div class="sheet">
    <div class="rail"><span class="mark">${MARK}</span>
      <span class="org"><b>T3CKGROUP</b>Purchasing department</span>
      <span class="doc"><div class="t">${esc(vm.number)}</div><div class="s">Packing List · ${esc(vm.stateLabel)}</div></span></div>
    <div class="head">
      <div class="l"><div class="kind">Packing List</div>
        <div class="who">${esc(vm.customer)}</div>
        <div class="meta">${esc([vm.sorReference, vm.projectTitle].filter(Boolean).join(' · '))}</div></div>
      <div class="r"><div class="k">Boxes</div><div class="big">${esc(t.boxCount)}<em>${t.boxCount === 1 ? 'box' : 'boxes'}</em></div></div>
    </div>
    <div class="hdr">
      ${field('SOR', vm.sorReference, { mono: true })}
      ${field('Odoo delivery ref', vm.odooDeliveryRef, { mono: true })}
      ${field('Created by', vm.createdBy)}
    </div>
    <section class="sec"><h3><span>Boxes</span><b>${esc(t.boxesLine)}</b></h3><div class="body">${boxes}</div></section>
    <div class="total-line"><span>${esc(t.weightLine)}</span></div>
    <div class="band"><div class="sigs n1">${sigBlock({
      role: esc(sig.role),
      who: esc(sig.who),
      title: esc(sig.title),
      state: sig.state,
      stamp: sig.stamp ? esc(sig.stamp) : undefined,
    })}</div></div>
    <div class="foot"><span>${esc(vm.number)}</span><span class="mid">Packed ${esc(vm.packedAt)}</span><span class="r">Purchasing</span></div>
  </div>`;
}

/** The full printable document: the same HTML the browser prints and "Save as PDF" converts. */
export function buildPackingListDocument(vm) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(vm.number)} · ${esc(vm.sorReference)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
<style>${CSS}${EXTRA_CSS}</style>
</head>
<body>
${buildPackingListSheetHtml(vm)}
</body>
</html>`;
}
