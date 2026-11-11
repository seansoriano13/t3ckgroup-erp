/**
 * The printed Transmittal as HTML (issue #258, spec #251, ADR 0014): the TG03
 * paper layout on A4 portrait, in the IPAS print's furniture so it reads as
 * part of the same paper set.
 *
 *   Page 1   rail, TRANSMITTAL FORM, Date and TN, the "checked by Technical"
 *            box, tick rows, the line grid, the legend
 *   Pages 2+ the grid continues, the column header repeated
 *   Last     the three stage sections, Received in Odoo, Check by
 *
 * Pure: a view model (transmittalViewModel.js) in, a document string out.
 * Everything typed or read from Odoo goes through `escapeHtml`, including what
 * `sigBlock` is handed. A waiting plate is drawn blank here: `sigBlock` would
 * print "Signature required", which the paper never does.
 */

import { MARK } from './brandMark';
import { PAPER_CSS as CSS } from './paperSet';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  .tbox { display: inline-flex; align-items: center; justify-content: center; width: 11px; height: 11px; border: 1px solid var(--ink); border-radius: 2px; line-height: 1; font-size: 7pt; overflow: hidden; flex: none; vertical-align: -2px; }
  .tg-ticks { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--s-3) 20px; font-size: var(--t-table); }
  .tg-ticks .g { display: flex; flex-direction: column; gap: 3px; }
  .tg-ticks .g > b { font-size: var(--t-micro); line-height: 1.3; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 1px; }
  .tg-ticks .o { display: flex; gap: 6px; align-items: center; }
  .tg-ticks .other { font-style: italic; }
  .tg-lines { display: flex; flex-direction: column; gap: var(--s-1); }
  .tg-sheet { --plate: 6mm; }
  .tg-grid td { height: 5mm; }
  .tg-grid td.c { text-align: center; font-family: var(--mono); }
  .tg-legend, .tg-cont { font-size: var(--t-fine); color: var(--ink-faint); }
  .tg-cont { font-style: italic; }
  .tg-stage.struck h3, .tg-stage.struck .rem { text-decoration: line-through; color: var(--ink-faint); }
  .tg-stage .rem { min-height: 5mm; white-space: pre-wrap; }
  .tg-stage .pics { font-size: var(--t-table); color: var(--ink-mid); }
  .tg-plates { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-3) 20px; }
  .tg-odoo { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-2) 20px; border-top: 1px solid var(--ink); padding-top: var(--s-2); }
  .tg-odoo .v { display: block; min-height: 1.3em; }
`;

const TICK = (on) => `<span class="tbox">${on ? '✕' : ''}</span>`;

/** A tick option; its Others text follows it when the option has one. */
const tick = (o) => `<span class="o">${TICK(o.ticked)}<span>${esc(o.label)}${o.other ? ` <i class="other">${esc(o.other)}</i>` : ''}</span></span>`;

/** The tick rows: origin, checking, priority, the reference checklist, company and product. */
function ticksHtml(vm) {
  const t = vm.ticks;
  return `<div class="tg-ticks">
    <div class="g"><b>Origin</b>${t.origin.map(tick).join('')}</div>
    <div class="g"><b>Checking</b>${t.checking.map(tick).join('')}</div>
    <div class="g"><b>Priority</b>${t.priority.map(tick).join('')}</div>
    <div class="g"><b>Reference checklist</b>${t.references.length ? t.references.map(tick).join('') : '<span class="o">—</span>'}</div>
    <div class="g"><b>Company</b><span>${esc(t.company)}</span></div>
    <div class="g"><b>Product</b><span>${esc(t.product)}</span></div>
  </div>`;
}

/** The column header, repeated on every page of the grid. */
const GRID_HEAD = `<thead><tr>
  <th style="width:6%">SN#</th><th style="width:24%">Item Name</th><th style="width:15%">Project Name (S.O)</th>
  <th style="width:9%">Quantity of Box</th><th style="width:13%">Whs Man: In-charge</th><th style="width:7%">Check (GC/NA)</th>
  <th style="width:13%">TCA: In-charge</th><th style="width:7%">Check (GC/NA)</th></tr></thead>`;

/** One grid page: its rows, blank rows included, so the paper's length shows. */
function gridHtml(page) {
  const body = page.rows
    .map((r) => `<tr><td>${esc(r.sn)}</td><td>${esc(r.item)}</td><td>${esc(r.project)}</td><td class="c">${esc(r.boxQuantity)}</td>
      <td>${esc(r.whInCharge)}</td><td class="c">${esc(r.whCheck)}</td><td>${esc(r.techInCharge)}</td><td class="c">${esc(r.techCheck)}</td></tr>`)
    .join('');
  return `<table class="grid tg-grid">${GRID_HEAD}<tbody>${body}</tbody></table>`;
}

/** A plate: a signed signer through `sigBlock`, a waiting one blank with its role. */
function plateHtml(p) {
  if (p.state === 'signed') {
    return sigBlock({
      role: esc(p.role),
      who: esc(p.who),
      title: '',
      state: 'signed',
      stamp: esc(p.stamp),
      signatureBase64: p.signatureBase64 || undefined,
    });
  }
  return `<div class="sig waiting"><div class="k">${esc(p.role)}</div><div class="plate"></div><div class="who"></div></div>`;
}

/** One stage section: its heading, remarks, pictures line and two plates. A stage the slip lacks is struck through. */
function stageHtml(s) {
  return `<section class="sec tg-stage${s.present ? '' : ' struck'}">
    <h3><span>${esc(s.title)}</span></h3>
    <div class="body"><div class="rem">${esc(s.remarks)}</div>
    <div class="pics">(Provided Pictures &amp; Videos) ${s.pictures === 'Yes' ? '<b>Yes</b> / No' : s.pictures === 'No' ? 'Yes / <b>No</b>' : 'Yes / No'}</div>
    <div class="tg-plates">${s.plates.map((p) => plateHtml(p)).join('')}</div></div>
  </section>`;
}

/** Check by: two plates, blank until signed, each with the call sign beneath. */
function checkByHtml(plates) {
  return `<div class="tg-plates">${plates
    .map((p) => `<div>${plateHtml(p)}<div class="sig"><div class="callsign">${esc(p.callSign)}</div></div></div>`)
    .join('')}</div>`;
}

/** The full sheet set as markup: one sheet per grid page, the last carrying the sections and sign-offs. */
export function buildTransmittalSheetsHtml(vm) {
  const last = vm.pages.length - 1;
  return vm.pages
    .map((page, i) => {
      const head = i === 0
        ? `<div class="rail"><span class="mark">${MARK}</span>
            <span class="org"><b>T3CKGROUP</b>Purchasing department</span>
            <span class="doc"><div class="t">${esc(vm.number)}</div><div class="s">TG03 · ${esc(vm.stateLabel)}</div></span></div>
          <div class="head">
            <div class="l"><div class="kind">TRANSMITTAL FORM</div>
              <div class="meta">${TICK(vm.techBox)} To be checked by Technical</div></div>
            <div class="r"><div class="f"><span class="k">Date</span><span class="v">${esc(vm.preparedOn)}</span></div><div class="f"><span class="k">TN</span><span class="v mono">${esc(vm.number)}</span></div></div>
          </div>
          ${ticksHtml(vm)}`
        : `<div class="rail"><span class="mark">${MARK}</span>
            <span class="org"><b>T3CKGROUP</b>TRANSMITTAL FORM</span>
            <span class="doc"><div class="t">${esc(vm.number)}</div><div class="s">continued</div></span></div>`;
      const legend = i === 0 ? `<div class="tg-legend">${esc(vm.legend)}</div>` : '';
      const cont = page.continued ? '<div class="tg-cont">Continued from the previous page</div>' : '';
      const tail = i === last
        ? `${vm.stages.map(stageHtml).join('')}
           <div class="tg-odoo"><div class="f"><span class="k">Received in Odoo by</span><span class="v">${esc(vm.odooReceived.by)}</span></div>
             <div class="f"><span class="k">At</span><span class="v">${esc(vm.odooReceived.at)}</span></div>
             <div class="f"><span class="k">Odoo ref</span><span class="v mono">${esc(vm.odooReceived.ref)}</span></div></div>
           <section class="sec tg-stage"><h3><span>Check by</span></h3><div class="body">${checkByHtml(vm.checkBy)}</div></section>`
        : '';
      const foot = `<div class="foot"><span>${esc(vm.number)}</span><span class="mid">Sheet ${i + 1} of ${vm.pages.length}</span><span class="r">Purchasing</span></div>`;
      return `<div class="sheet tg-sheet dense">${head}<div class="tg-lines">${cont}${gridHtml(page)}${legend}</div>${tail}${foot}</div>`;
    })
    .join('');
}

/** The full printable document: the same HTML the browser prints and "Save as PDF" converts. */
export function buildTransmittalDocument(vm) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(vm.number)} · TG03</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
<style>${CSS}${EXTRA_CSS}</style>
</head>
<body>
${buildTransmittalSheetsHtml(vm)}
</body>
</html>`;
}
