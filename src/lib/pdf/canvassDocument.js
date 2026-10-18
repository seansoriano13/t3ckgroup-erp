/**
 * The printed Canvass as HTML (issue #282, spec #275, ADR 0014): one A4 portrait sheet, variant C
 * of the prototype ("Recommendation first"). The decision block leads; every Offer is tabled
 * beneath as evidence; the signatures close the page.
 *
 * Pure: a view model (canvassViewModel.js) in, a document string out. Everything typed or read
 * from outside goes through `escapeHtml`.
 */

import { MARK } from './brandMark';
import { CSS } from './ipasDocument';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  .cnv-facts { display: flex; flex-wrap: wrap; gap: 6px 28px; padding: 7px 0; border-bottom: 1px solid var(--hair); }
  .cnv-facts .fact { display: flex; flex-direction: column; gap: 2px; }
  .cnv-facts .v { font-size: 9pt; font-weight: 600; }
  .decision { border: 1.5px solid var(--rule); padding: 12px 16px; display: grid; grid-template-columns: 1fr 56mm; gap: 12px; border-radius: 4px; }
  .decision h2 { font-family: var(--serif); font-size: 14pt; margin: 0 0 3px; font-weight: 600; }
  .decision .why { font-size: 8.8pt; line-height: 1.35; margin: 5px 0 0; white-space: pre-wrap; }
  .decision .why.none { color: var(--ink-faint); }
  .decision .price { text-align: right; }
  .decision .price .v { font-family: var(--mono); font-size: 16pt; line-height: 1.1; letter-spacing: -.02em; font-weight: 700; }
  .decision .price .f { font-family: var(--mono); font-size: 7.6pt; color: var(--ink-mid); margin-top: 3px; }
  .cnv-offers th, .cnv-offers td { text-align: left; vertical-align: top; padding: 6px 8px; border-bottom: 1px solid var(--hair); font-size: 8pt; }
  .cnv-offers thead th { font-size: 6.6pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-mid); border-bottom: 1.5px solid var(--rule); }
  .cnv-offers td.num, .cnv-offers th.num { text-align: right; font-family: var(--mono); }
  .cnv-offers tr.chosen td { background: var(--wash); }
  .chip { display: inline-block; font-size: 6.2pt; letter-spacing: .07em; text-transform: uppercase; padding: 1px 6px; border: 1px solid var(--ink); border-radius: 3px; font-weight: 700; margin-left: 4px; }
  .chip.warn { color: var(--flag); border-color: var(--flag); margin-left: 0; }
  .cnv-warning { border: 1px solid var(--flag); color: var(--flag); padding: 5px 10px; font-size: 8.4pt; font-weight: 600; border-radius: 3px; margin-top: auto; }
  .sigs.n3 { grid-template-columns: repeat(3, 1fr); margin-top: auto; padding-top: 4mm; }
  .cnv-warning + .sigs.n3 { margin-top: 0; }
`;

/** The decision block: the chosen supplier, brand, lead time and validity; the price large; the reason as written. */
function decisionHtml(d) {
  const reason = d.reason
    ? `<p class="why">${esc(d.reason)}</p>`
    : '<p class="why none">No reason recorded.</p>';
  const price = d.price
    ? `<div class="k">Unit price</div><div class="v">${esc(d.price)}</div>${d.foreign ? `<div class="f">${esc(d.foreign)}</div>` : ''}`
    : '';
  return `<div class="decision">
    <div><div class="k">Recommended</div><h2>${esc(d.supplier)}</h2>
      ${d.detail ? `<div class="sub">${esc(d.detail)}</div>` : ''}${reason}</div>
    <div class="price">${price}</div>
  </div>`;
}

/** Every Offer, the chosen one marked. */
function offersHtml(offers) {
  if (offers.length === 0) return '<div class="sub">No offers recorded.</div>';
  const rows = offers
    .map(
      (o) => `<tr class="${o.chosen ? 'chosen' : ''}">
        <td><b>${esc(o.supplier)}</b>${o.chosen ? '<span class="chip">chosen</span>' : ''}${o.brand ? `<div class="sub">${esc(o.brand)}</div>` : ''}</td>
        <td>${esc(o.offered)}${o.remarks ? `<div class="sub">${esc(o.remarks)}</div>` : ''}</td>
        <td class="num">${esc(o.quoted)}</td>
        <td class="num">${esc(o.php)}${o.foreign ? `<div class="sub">${esc(o.foreign)}</div>` : ''}</td>
        <td>${esc(o.leadTime)}</td>
        <td>${esc(o.validUntil)}</td>
        <td>${o.brochure ? esc(o.brochure) : '<span class="chip warn">none</span>'}</td>
      </tr>`,
    )
    .join('');
  return `<table class="cnv-offers"><thead><tr>
      <th>Supplier</th><th>Offered</th><th class="num">Quoted</th><th class="num">In PHP</th><th>Lead</th><th>Valid to</th><th>Brochure</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/** The three signature plates through `sigBlock`, so the stored-signature rule reads as on every other form. */
function signaturesHtml(blocks) {
  return `<div class="sigs n3">${blocks
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
    .join('')}</div>`;
}

/** The whole sheet as markup. */
export function buildCanvassSheetHtml(vm) {
  const h = vm.header;
  const fact = (k, v) => `<div class="fact"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  return `<div class="sheet">
    <div class="rail"><span class="mark">${MARK}</span>
      <span class="org"><b>T3CKGROUP</b>Purchasing</span>
      <span class="doc"><div class="t">Canvass</div><div class="s">${esc(vm.number)}</div></span></div>
    <div class="cnv-facts">
      ${fact(h.subjectKind === 'Requested Item' ? 'Requested Item' : 'For', h.subject)}
      ${h.raised ? fact('Raised', h.raised) : ''}
      ${fact('Offers', String(h.offerCount))}
    </div>
    ${decisionHtml(vm.decision)}
    ${offersHtml(vm.offers)}
    ${vm.warning ? `<div class="cnv-warning" data-testid="more-offers-warning">${esc(vm.warning)}</div>` : ''}
    ${signaturesHtml(vm.signatures)}
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
