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
import { CSS } from './ipasDocument';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  .tsr-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; font-size: 8.4pt; padding: 6px 0; border-bottom: 1px solid var(--hair); }
  .tsr-facts .f { display: flex; gap: 8px; }
  .tsr-facts .k { color: var(--ink-faint); min-width: 92px; font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; }
  .tsr-units { width: 100%; border-collapse: collapse; font-size: 8pt; margin-top: 6px; }
  .tsr-units th, .tsr-units td { border-bottom: 1px solid var(--hair); padding: 4px 6px; text-align: left; vertical-align: top; }
  .tsr-units th { font-size: 6.8pt; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-mid); }
  .tsr-units tr.fail td { font-weight: 600; }
  .tsr-evidence { font-size: 8.4pt; border-top: 1px solid var(--hair); padding-top: 6px; margin-top: 8px; }
  .tsr-evidence .k { font-size: 7.6pt; text-transform: uppercase; letter-spacing: .04em; color: var(--ink-faint); }
  .tsr-photos { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-top: 6px; }
  .tsr-photos img { width: 100%; height: 110px; object-fit: cover; border: 1px solid var(--hair); }
  .tsr-foot { display: flex; justify-content: space-between; font-size: 8.4pt; border-top: 1px solid var(--ink); padding-top: 5px; margin-top: 8px; }
  .tsr-sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
  .tsr-sigs .sig.waiting .plate { border-bottom: 1px solid var(--ink-faint); height: 34px; }
`;

const fact = (k, v) => `<div class="f"><span class="k">${esc(k)}</span><span>${esc(v)}</span></div>`;

/** The plate: a signed signer through `sigBlock`, a waiting one blank with its role. */
function plateHtml(p) {
  if (p.state === 'signed') {
    return sigBlock({ role: esc(p.role), who: esc(p.who), title: '', state: 'signed', stamp: esc(p.stamp) });
  }
  return `<div class="sig waiting"><div class="k">${esc(p.role)}</div><div class="plate"></div><div class="who"></div></div>`;
}

/** The unit table: serial, verdict, and the remark in full. */
function unitsHtml(units) {
  if (!units.length) return '<div class="tsr-evidence">No units recorded.</div>';
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
    <div class="tsr-facts">
      ${fact('Item', f.item)}
      ${fact('Transmittal', f.transmittal)}
      ${fact('Follows', f.line)}
      ${fact('SOR', f.sor)}
      ${fact('PO', f.po)}
      ${fact('Checked by', `${f.checkedBy} · ${f.checkedAt}`)}
    </div>
    <section class="sec"><h3><span>Units</span></h3><div class="body">${unitsHtml(vm.units)}</div></section>
    <div class="tsr-evidence"><div class="k">Evidence</div><div>${esc(vm.evidence.summary)}</div>${pictures}</div>
    ${vm.failure ? `<div class="tsr-foot"><span>${esc(vm.failure)}</span></div>` : ''}
    <div class="tsr-sigs">${sigs}</div>
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
