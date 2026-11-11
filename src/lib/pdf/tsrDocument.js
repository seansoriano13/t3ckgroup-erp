/**
 * The printed TSR as HTML (issue #259, spec #251, ADR 0014): one plain A4
 * portrait sheet. The default prints the evidence by name and embeds no
 * images; `withPhotographs` (the filing copy) embeds the pictures passed in as
 * data URIs. Videos never print.
 *
 * Pure: a view model (tsrViewModel.js) in, a document string out. Everything
 * typed or read from Odoo goes through `escapeHtml`.
 */

import { MARK } from './brandMark';
import { PAPER_CSS as CSS } from './paperSet';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  .tsr-facts .wide { grid-column: 1 / -1; }
  .tsr-units tr.fail td { font-weight: 600; }
  .tsr-photos { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--s-2); }
  .tsr-photos img { width: 100%; height: 38mm; object-fit: cover; border: 1px solid var(--hair); break-inside: avoid; }
`;

const fact = (k, v, wide = false) => `<div class="f${wide ? ' wide' : ''}"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;

/** The plate: a signed signer through `sigBlock`, a waiting one blank with its role. */
function plateHtml(p) {
  if (p.state === 'signed') {
    return sigBlock({ role: esc(p.role), who: esc(p.who), title: '', state: 'signed', stamp: esc(p.stamp) });
  }
  return `<div class="sig waiting"><div class="k">${esc(p.role)}</div><div class="plate"></div><div class="who"></div></div>`;
}

/** The unit table: serial, verdict, and the remark in full. */
function unitsHtml(units) {
  if (!units.length) return '<div class="empty">No units recorded.</div>';
  const rows = units
    .map((u) => `<tr class="${u.failed ? 'fail' : ''}"><td>${esc(u.serial)}</td><td>${esc(u.verdict)}</td><td>${esc(u.remark)}</td></tr>`)
    .join('');
  return `<table class="tsr-units"><thead><tr><th style="width:30%">Serial</th><th style="width:12%">Verdict</th><th>Remark</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/** The whole sheet as markup. `photos` are `{ src, fileName }` data URIs, embedded only with `withPhotographs`. */
export function buildTsrSheetHtml(vm, { withPhotographs = false, photos = [] } = {}) {
  const f = vm.facts;
  const pictures = withPhotographs && photos.length
    ? `<div class="tsr-photos">${photos.map((p) => `<img src="${p.src}" alt="${esc(p.fileName)}">`).join('')}</div>`
    : '';
  const sigs = [vm.signatures.checkedBy, vm.signatures.notedBy].filter(Boolean).map(plateHtml).join('');
  return `<div class="sheet">
    <div class="rail"><span class="mark">${MARK}</span>
      <span class="org"><b>T3CKGROUP</b>Technical Service Report</span>
      <span class="doc"><div class="t">${esc(vm.number)}</div><div class="s">Technical Service Report</div></span></div>
    <div class="head"><div class="l"><div class="kind">Technical Service Report</div>
      <div class="who">${esc(f.item)}</div></div></div>
    <div class="hdr tsr-facts">
      ${fact('Item', f.item)}
      ${fact('Transmittal', f.transmittal)}
      ${fact('Follows', f.line)}
      ${fact('SOR', f.sor)}
      ${fact('PO', f.po)}
      ${fact('Checked by', `${f.checkedBy} · ${f.checkedAt}`)}
      ${fact('Remarks', f.remarks, true)}
    </div>
    <section class="sec"><h3><span>Units</span></h3><div class="body">${unitsHtml(vm.units)}</div></section>
    <section class="sec"><h3><span>Evidence</span></h3><div class="body"><div>${esc(vm.evidence.summary)}</div>${pictures}</div></section>
    ${vm.failure ? `<div class="total-line flagged"><span>${esc(vm.failure)}</span></div>` : ''}
    <div class="band"><div class="sigs n2">${sigs}</div></div>
    <div class="foot"><span>${esc(vm.number)}</span><span class="mid">${vm.printedOn ? `Printed ${esc(vm.printedOn)}` : ''}</span><span class="r">Technical</span></div>
  </div>`;
}

/** The full printable document: the same HTML the browser prints and "Save as PDF" converts. */
export function buildTsrDocument(vm, options = {}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(vm.number)} · TSR</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
<style>${CSS}${EXTRA_CSS}</style>
</head>
<body>
${buildTsrSheetHtml(vm, options)}
</body>
</html>`;
}
