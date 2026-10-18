/**
 * The printed Canvass as HTML (issue #282, spec #275, ADR 0014): one A4 portrait sheet in the IPAS
 * print's furniture (rail, serif name, hairlines, the signature band), so it reads as part of the
 * same Purchasing paper set. The recommendation leads (variant C of the prototype); every Offer is
 * tabled beneath as evidence; the signatures close the page.
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
  .cnv-offers td .sub { margin-top: 2px; }
  .cnv-offers td.num .sub { font-size: 6.6pt; color: var(--ink-faint); white-space: normal; }
  .cnv-offers td.num + td:not(.num), .cnv-offers th.num + th:not(.num) { padding-left: 12px; }
  .sigs.n3 { grid-template-columns: repeat(3, 1fr); }
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

/** Every Offer, the chosen one ticked. */
function offersHtml(offers) {
  const count = `${offers.length} ${offers.length === 1 ? 'offer' : 'offers'}`;
  if (offers.length === 0) {
    return `<section class="sec"><h3><span>Offers</span><b>${count}</b></h3><div class="body"><div class="empty">No offers recorded.</div></div></section>`;
  }
  const rows = offers
    .map(
      (o) => `<tr class="${o.chosen ? 'chosen' : ''}">
        <td><b>${esc(o.supplier)}</b>${o.chosen ? ' <span class="prov final">Chosen</span>' : ''}${o.brand ? `<div class="sub">${esc(o.brand)}</div>` : ''}</td>
        <td>${esc(o.offered)}${o.remarks ? `<div class="sub">${esc(o.remarks)}</div>` : ''}</td>
        <td class="num">${esc(o.quoted)}</td>
        <td class="num">${esc(o.php)}${o.foreign ? `<div class="sub">${esc(o.foreign)}</div>` : ''}</td>
        <td>${esc(o.leadTime)}</td>
        <td>${esc(o.validUntil)}</td>
        <td>${o.brochure ? esc(o.brochure) : '<span class="empty">None</span>'}</td>
      </tr>`,
    )
    .join('');
  return `<section class="sec"><h3><span>Offers</span><b>${count}</b></h3><div class="body">
    <table class="cnv-offers"><thead><tr>
      <th style="width:18%">Supplier</th><th>Offered</th><th class="num" style="width:13%">Quoted</th><th class="num" style="width:13%">In PHP</th><th style="width:9%">Lead</th><th style="width:11%">Valid to</th><th style="width:12%">Brochure</th>
    </tr></thead><tbody>${rows}</tbody></table></div></section>`;
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
      ${field(h.subjectKind === 'Requested Item' ? 'Requested Item' : 'SOR · Component', h.subject)}
      ${field('Raised', h.raised)}
      ${field('Offers', String(h.offerCount), { mono: true })}
    </div>
    ${reasonHtml(vm.decision.reason)}
    ${offersHtml(vm.offers)}
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
