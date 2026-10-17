/**
 * The printed Costing Matrix as HTML (issue #274, spec #266, ADR 0014), drawn in the IPAS print's
 * furniture (ipasDocument.js) so it reads as part of the same Purchasing paper set: rail, serif
 * name, one big mono figure, a right-hand column of figures, ruled section heads and a signature
 * band. It keeps A4 LANDSCAPE for the Tender Line table.
 *
 *   Sheet 1  money (Closed Book only)  rail and head (the Final Offer as the one big figure), the
 *                                      Tender Line table under its owner bands, cost-only rows,
 *                                      the evaluation and the Bid Decision; beside them the margin
 *                                      and the summary; the four signature boxes across the foot
 *   Sheet 2  specification appendix    each Tender Specification in full against its Components'
 *                                      Offer Specifications and Compliance, then the Inclusions.
 *                                      Prints for every tier that can read the matrix; no figures
 *
 * Pure: a view model (costingMatrixViewModel.js) in, a document string out. The composer draws only
 * what the view model carries, so a tier without money gets no money markup at all. Everything typed
 * goes through `escapeHtml`, including what `sigBlock` is handed.
 */

import { MARK } from './brandMark';
import { CSS as IPAS_CSS } from './ipasDocument';
import { escapeHtml as esc, sigBlock } from './sigBlock';

const EXTRA_CSS = `
  @page { size: A4 landscape; margin: 0; }
  .sheet { width: 297mm; min-height: 209mm; padding: 9mm 13mm 7mm; gap: 3mm; }
  .sheet + .sheet { break-before: page; page-break-before: always; }

  .head .company b + .k { margin-left: 14px; }
  .head .abc { width: 46mm; margin: 6px 0 0 auto; }
  .bar { height: 3px; background: var(--hair); position: relative; }
  .bar span { position: absolute; inset: 0 auto 0 0; background: var(--ink); }
  .bar.over span { background: var(--flag); }
  .over-abc { color: var(--flag); font-weight: 600; }

  .cols { gap: 22px; }
  .cR { flex-basis: 74mm; gap: 4mm; }

  .lines td.no { font-family: var(--mono); font-weight: 600; white-space: nowrap; }
  .lines tr.line td { font-weight: 600; }
  .lines tr.line td .sub { font-weight: 400; }
  .lines thead tr.owner th { border-bottom: 0; padding-bottom: 1px; letter-spacing: .1em; color: var(--ink-mid); }
  .lines .wait { font-family: var(--sans); font-size: 6.4pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); white-space: nowrap; }

  .notes { display: flex; flex-direction: column; gap: 4px; }
  .notes .n { font-size: 7.8pt; line-height: 1.4; padding-left: 8px; border-left: 1px solid var(--rule); break-inside: avoid; }
  .notes .n.flagged { border-left-color: var(--flag); }
  .notes .n b { font-weight: 600; }
  .notes .n.flagged b { color: var(--flag); }

  .blk .row.strong { border-top: 1px solid var(--ink); padding-top: 5px; margin-top: 2px; font-size: 8.6pt; }
  .blk .row.strong .a { color: var(--ink); font-weight: 600; }
  .blk .row.strong .b { font-weight: 600; }
  .cR .blk .rows { gap: 3px; margin-top: 4px; }
  .blk .row .a .h { margin-left: 4px; font-size: 6.4pt; color: var(--ink-faint); }
  .head { padding: 2mm 0 2.5mm; }
  .head .big { font-size: 21pt; }
  .blk .row .b.note { font-family: var(--sans); font-style: italic; color: var(--ink-faint); font-weight: 400; }
  .fine { font-size: 6.6pt; line-height: 1.4; color: var(--ink-faint); }

  .band { padding-top: 3mm; }
  .sig .plate { height: 8mm; }
  .sig .pending { color: var(--flag); }

  .entry { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; border-top: 1px solid var(--hair); padding: 5px 0 6px; break-inside: avoid; }
  .entry:first-child { border-top: 0; padding-top: 0; }
  .entry ul { margin: 2px 0 0; padding-left: 12px; font-size: 7.8pt; line-height: 1.42; }
  .entry .name { font-weight: 600; margin-top: 2px; }
  .entry .src { font-size: 7pt; color: var(--ink-faint); margin-top: 3px; font-family: var(--mono); }
  .entry .verdict { margin-top: 4px; font-size: 7.6pt; line-height: 1.38; }
  .entry .verdict .sub { margin-top: 2px; }
  .tag-state.deviates { color: var(--flag); border-color: var(--flag); }
  .tag-state.complies { border-color: var(--ink); color: var(--ink); }
  .incl { margin-top: 2px; }
  .incl .s.missing { color: var(--flag); font-weight: 500; }
  .incl .s.missing .chk { border-color: var(--flag); color: var(--flag); }
`;

// ── furniture ────────────────────────────────────────────────────────────────

const sheetLabel = (vm, key, name) => `sheet ${vm.sheets.indexOf(key) + 1} of ${vm.sheets.length} · ${name}`;

const rail = (vm, key) => `<div class="rail"><span class="mark">${MARK}</span>
    <span class="org"><b>${esc(vm.entity)}</b>Purchasing department</span>
    <span class="doc"><div class="t">${esc(vm.number)}</div>
    <div class="s">Costing Matrix · sheet ${vm.sheets.indexOf(key) + 1} of ${vm.sheets.length}</div></span></div>`;

const section = (title, aside, body) =>
  `<section class="sec"><h3><span>${title}</span>${aside ? `<b>${aside}</b>` : ''}</h3><div class="body">${body}</div></section>`;

const row = (label, value, { hint = '', strong = false, wait = false, note = false } = {}) =>
  `<div class="row${strong ? ' strong' : ''}"><span class="a">${esc(label)}${hint ? `<span class="h">${esc(hint)}</span>` : ''}</span><span class="b${wait ? ' wait' : ''}${note ? ' note' : ''}">${esc(value)}</span></div>`;

const tick = (on, cls = '') => `<span class="chk${on ? ' done' : ''}${cls ? ` ${cls}` : ''}">${on ? '✓' : cls === 'missing' ? '✗' : ''}</span>`;

function foot(vm, notes, label) {
  const printed = [vm.printedAt ? `printed ${vm.printedAt}` : null, vm.printedBy ? `by ${vm.printedBy}` : null].filter(Boolean).join(' ');
  return `<div class="foot">
    <span>${esc(vm.number)} · Costing Matrix${printed ? `<br>${esc(printed)}` : ''}</span>
    <span class="mid">${esc(notes)}</span>
    <span class="r">${esc(label)}</span>
  </div>`;
}

// ── sheet 1: money ───────────────────────────────────────────────────────────

/** The head: whose bid it is, and the one figure the sheet exists to sign, the Final Offer against the ABC. */
function moneyHead(vm) {
  const m = vm.money;
  const s = m.strip;
  const bar =
    s.abcBar === null
      ? ''
      : `<div class="abc"><div class="bar${s.overAbc ? ' over' : ''}"><span style="width:${s.abcBar.toFixed(1)}%"></span></div></div>`;
  return `<div class="head">
    <div class="l"><div class="kind">Costing Matrix</div>
      <div class="who">${esc(vm.projectTitle)}</div>
      <div class="meta">${esc([vm.clientName, m.facts.incharge].filter(Boolean).join(' · '))}</div>
      <div class="company"><span class="k">ABC</span> <b>${esc(m.facts.abc)}</b><span class="k">Target markup</span> <b>${esc(m.facts.targetMarkup)}</b></div></div>
    <div class="r"><div class="k">Final offer</div>
      ${
        String(s.finalOffer).startsWith('PHP ')
          ? `<div class="big">${esc(String(s.finalOffer).replace(/^PHP /, '₱'))}<em>PHP</em></div>`
          : `<div class="big na">${esc(s.finalOffer)}</div>`
      }
      ${
        s.abcBar === null
          ? ''
          : `<div class="ledger${s.overAbc ? ' over-abc' : ''}">${esc(s.abcPercent)} of the ABC${s.overAbc ? ' · over the ABC' : ''}</div>${bar}`
      }</div>
  </div>`;
}

/** The Tender Lines and cost-only rows under the owner bands: who writes each column. */
function moneyTable(money) {
  const lines = money.lines
    .map(
      (l) => `<tr class="line"><td class="no">${esc(l.number)}</td>
        <td>${esc(l.name)}<div class="sub">${esc(l.detail)}</div></td>
        <td class="num">${esc(l.abc)}</td><td class="num">${esc(l.finalOffer)}</td>
        <td class="num">${esc(l.acquire)}</td><td class="num">${esc(l.finalAcquire)}</td>
        <td class="num">${esc(l.achieved)}</td><td class="num"><span class="wait">${esc(l.landedCost)}</span></td></tr>`,
    )
    .join('');
  const costRows = money.costRows
    .map(
      (r) => `<tr><td class="no">${esc(r.number)}</td>
        <td>${esc(r.description)}<div class="sub">Cost only: no specification, no offer line</div></td>
        <td class="num">—</td><td class="num">—</td>
        <td class="num">${esc(r.acquire)}</td><td class="num">${esc(r.finalAcquire)}</td>
        <td class="num">${esc(r.factor)}</td><td class="num"><span class="wait">${esc(r.landedCost)}</span></td></tr>`,
    )
    .join('');
  const empty = money.lines.length + money.costRows.length === 0 ? '<tr><td colspan="8" class="empty">No Tender Lines yet.</td></tr>' : '';
  return `<table class="lines">
    <colgroup><col style="width:9mm"><col><col style="width:25mm"><col style="width:25mm"><col style="width:25mm"><col style="width:25mm"><col style="width:17mm"><col style="width:22mm"></colgroup>
    <thead>
      <tr class="band owner"><th colspan="2"></th><th class="num">Client</th><th class="num">Sales</th><th class="num">Purchasing</th><th class="num">Management</th><th class="num">Automatic</th><th class="num">After purchase</th></tr>
      <tr><th>No.</th><th>Tender line · PHP</th><th class="num">ABC</th><th class="num">Final offer</th><th class="num">Acquire</th><th class="num">Final acquire</th><th class="num">Achieved</th><th class="num">Landed cost</th></tr>
    </thead>
    <tbody>${lines}${costRows}${empty}</tbody></table>`;
}

/** What Technical found and what Management decided, in prose. */
function findings(money) {
  const notes = [];
  if (money.deviations.length === 0) notes.push('<div class="n"><b>No deviations.</b> Every evaluated Component complies with what was asked.</div>');
  for (const d of money.deviations) notes.push(`<div class="n flagged"><b>Deviation.</b> ${esc(d.text)}</div>`);
  if (money.notEvaluated > 0) {
    notes.push(`<div class="n">${esc(String(money.notEvaluated))} ${money.notEvaluated === 1 ? 'Component has' : 'Components have'} no verdict yet.</div>`);
  }
  const bid = money.bidDecision;
  notes.push(
    bid
      ? `<div class="n${bid.verdict === 'Go' ? '' : ' flagged'}"><b>Bid Decision: ${esc(bid.verdict)}.</b> ${esc(bid.reason)}
          <div class="sub">Decided by ${esc(bid.decidedBy)} on ${esc(bid.decidedOn)}, against a Final Offer of ${esc(bid.finalOffer)} and an ABC of ${esc(bid.abc)}.</div></div>`
      : '<div class="n"><b>Bid Decision:</b> none taken yet.</div>',
  );
  return `<div class="notes">${notes.join('')}</div>`;
}

/** The right-hand column: the margin, then the summary as the sheet adds it up. */
function figures(money) {
  const s = money.strip;
  const margin = `<div class="blk"><div class="k">Margin</div><div class="rows">
    ${row('Cost', s.cost, { hint: 'Final Acquire total' })}
    ${row('Landed cost', s.landedCost, { wait: true })}
    ${row('Markup target', s.target)}
    ${row('Achieved', s.achieved)}
  </div></div>`;
  const summary = `<div class="blk"><div class="k">Summary</div><div class="rows">${money.summary
    .map((r) => row(r.label, r.value, { hint: r.hint, strong: r.strong, note: String(r.value).startsWith('Incomplete') }))
    .join('')}</div></div>`;
  return `${margin}${summary}
    <div class="fine">Every figure on this sheet is the bid estimate. Landed Cost replaces nothing: it prints beside these once the purchases are made.</div>`;
}

function moneySheet(vm) {
  const m = vm.money;
  const boxes = m.signoffs
    .map((s) => sigBlock({ role: esc(s.role), who: esc(s.who), title: esc(s.title), state: s.state, signatureBase64: s.signatureBase64, stamp: s.stamp ? esc(s.stamp) : undefined }))
    .join('');
  return `<div class="sheet money">
    ${rail(vm, 'money')}${moneyHead(vm)}
    <div class="cols">
      <div class="cL">${section('Tender lines', `${m.lines.length} ${m.lines.length === 1 ? 'line' : 'lines'}`, moneyTable(m))}${section('Evaluation and Bid Decision', '', findings(m))}</div>
      <div class="cR">${figures(m)}</div>
    </div>
    <div class="band"><div class="sigs n4">${boxes}</div></div>
    ${foot(vm, 'Landed Cost provisional until purchasing marks costs complete', sheetLabel(vm, 'money', 'money'))}
  </div>`;
}

// ── sheet 2: the appendix ────────────────────────────────────────────────────

const list = (lines) => `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;

function verdict(c) {
  if (c.compliance === 'complies') {
    return `<div class="verdict"><span class="tag-state complies">complies</span> ${c.note ? esc(c.note) : 'Judged against the full specification.'}</div>`;
  }
  if (c.compliance === 'deviates') {
    return `<div class="verdict"><span class="tag-state deviates">deviates</span> ${esc(c.note ?? '')}${c.alternative ? `<div class="sub">Recommended instead: ${esc(c.alternative)}</div>` : ''}</div>`;
  }
  return '<div class="verdict"><span class="tag-state">not evaluated</span></div>';
}

function entry(line, c) {
  return `<div class="entry">
    <div><span class="k">What the client asked for</span>${list(line.specLines)}</div>
    <div><span class="k">${esc(c.number)} · what we offer${c.brand ? ` · ${esc(c.brand)}` : ''}</span>
      <div class="name">${esc(c.name)}</div>${list(c.offerLines)}
      ${c.sourcing || c.po ? `<div class="src">${esc([c.sourcing, c.po].filter(Boolean).join(' · '))}</div>` : ''}
      ${verdict(c)}</div>
  </div>`;
}

function inclusions(inclusion) {
  const groups = inclusion.groups
    .map(
      (g) => `<div>${g.heading ? `<div class="group-k">${esc(g.heading)}</div>` : ''}<div class="stat incl">${g.items
        .map(
          (i) => `<span class="s${i.state === 'missing' ? ' missing' : i.state === 'not_required' ? '' : ' done'}">${tick(
            i.state !== 'missing' && i.state !== 'not_required',
            i.state === 'missing' ? 'missing' : '',
          )}<span class="t">${esc(i.description)}${i.quantity ? ` × ${esc(i.quantity)}` : ''}</span></span>`,
        )
        .join('')}</div></div>`,
    )
    .join('');
  return `<div class="box"><div class="group-k">Inclusions checked against the ask · ${esc(inclusion.owner)} · ${esc(inclusion.covered)}</div>${
    groups || '<div class="empty">No Inclusions listed.</div>'
  }</div>`;
}

function appendixLine(line) {
  const entries = line.components.length
    ? line.components.map((c) => entry(line, c)).join('')
    : `<div class="entry"><div><span class="k">What the client asked for</span>${list(line.specLines)}</div>
        <div><span class="k">What we offer</span><div class="empty">No Component offered against this line yet.</div></div></div>`;
  return section(`Tender line ${esc(line.number)} · ${esc(line.name)}`, line.quantity ? esc(line.quantity) : '', `${entries}${line.inclusions.map(inclusions).join('')}`);
}

function appendixSheet(vm) {
  const body = vm.appendix.lines.length ? vm.appendix.lines.map(appendixLine).join('') : '<div class="empty">No Tender Lines yet.</div>';
  return `<div class="sheet appendix">
    ${rail(vm, 'appendix')}
    <div class="head"><div class="l"><div class="kind">Costing Matrix · specification appendix</div>
      <div class="who">${esc(vm.projectTitle)}</div><div class="meta">${esc(vm.clientName)}</div></div></div>
    ${body}
    ${foot(vm, 'The full specification, judged line by line. No figures.', sheetLabel(vm, 'appendix', 'specifications'))}
  </div>`;
}

// ── document ─────────────────────────────────────────────────────────────────

export const CSS = `${IPAS_CSS}${EXTRA_CSS}`;

export function buildCostingMatrixPagesHtml(vm) {
  return `${vm.money ? moneySheet(vm) : ''}${appendixSheet(vm)}`;
}

export function buildCostingMatrixDocument(vm) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(vm.number)} · Costing Matrix</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Spectral:ital,wght@0,400;0,500;0,600;1,400;1,500&display=swap">
<style>${CSS}</style>
</head>
<body>
${buildCostingMatrixPagesHtml(vm)}
</body>
</html>`;
}
