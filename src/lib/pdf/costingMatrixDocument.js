/**
 * The printed Costing Matrix as HTML (issue #274, spec #266, ADR 0014): A4 LANDSCAPE, in the
 * prototype's "money sheet + appendix" layout (#229, variant C) with variant B's margin strip and
 * variant A's owner-band header.
 *
 *   Sheet 1  money (Closed Book only)  rail, facts, the Tender Line table under its owner bands,
 *                                      cost-only rows, deviations and the Bid Decision in prose, the
 *                                      four signature blocks; beside them the margin strip and summary
 *   Sheet 2  specification appendix    each Tender Specification in full against its Components'
 *                                      Offer Specifications and Compliance, then the Inclusions.
 *                                      Prints for every tier that can read the matrix; no figures
 *
 * Pure: a view model (costingMatrixViewModel.js) in, a document string out. The composer draws only
 * what the view model carries, so a tier without money gets no money markup at all. Everything typed
 * goes through `escapeHtml`, including what `sigBlock` is handed.
 */

import { MARK } from './brandMark';
import { escapeHtml as esc, sigBlock } from './sigBlock';

export const CSS = `
  :root {
    --paper: #ffffff; --ink: #0f1419; --ink-mid: #272f3a; --ink-soft: #3f4753; --ink-faint: #545f6e;
    --rule: #cbd5e1; --hair: #e2e8f0; --wash: #f8fafc;
    --accent: #0d4f3c; --flag: #b91c1c; --flag-bg: #fef2f2; --ok: #15803d; --ok-bg: #f0fdf4;
    --sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: "Geist Mono", ui-monospace, "SFMono-Regular", Consolas, monospace;
    --serif: "Spectral", ui-serif, Georgia, "Times New Roman", serif;
  }
  * { box-sizing: border-box; }
  @page { size: A4 landscape; margin: 0; }
  html, body { margin: 0; padding: 0; background: #ffffff; color: var(--ink); font-family: var(--sans); -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  .sheet {
    width: 297mm; min-height: 209mm; margin: 0 auto; padding: 10mm 12mm 9mm;
    display: flex; flex-direction: column; gap: 4.5mm;
    font-size: 8.6pt; line-height: 1.32; background: var(--paper); color: var(--ink);
    break-after: page; page-break-after: always;
  }
  .sheet:last-child { break-after: auto; page-break-after: auto; }
  .m { font-family: var(--mono); font-variant-numeric: tabular-nums; }

  .rail { display: flex; align-items: flex-end; gap: 10px; border-bottom: 1.4px solid var(--ink); padding-bottom: 4px; }
  .rail .mark { width: 22px; height: 22px; color: var(--accent); flex: none; }
  .rail .mark svg { width: 100%; height: 100%; display: block; }
  .rail .org { font-size: 7.4pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); line-height: 1.25; font-weight: 500; }
  .rail .org b { display: block; font-size: 10pt; letter-spacing: .03em; color: var(--ink); font-weight: 700; }
  .rail .doc { margin-left: auto; text-align: right; }
  .rail .doc .t { font-family: var(--serif); font-size: 15pt; font-weight: 600; line-height: 1; }
  .rail .doc .s { font-family: var(--mono); font-size: 7.4pt; color: var(--ink-soft); letter-spacing: .04em; }

  .facts { display: flex; flex-wrap: wrap; gap: 3px 26px; padding-bottom: 2px; }
  .fact { display: flex; flex-direction: column; gap: 2px; }
  .fact .k { font-size: 6.8pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; }
  .fact .v { font-size: 9.2pt; font-weight: 600; }
  .fact .v.m { font-weight: 500; }

  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; vertical-align: top; padding: 6px 7px; color: var(--ink); }
  thead th { font-size: 6.8pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; border-bottom: 1.4px solid var(--ink); white-space: nowrap; padding: 5px 7px; }
  thead tr.band th { font-size: 6.4pt; color: var(--ink-faint); letter-spacing: .1em; border-bottom: 0; padding: 4px 7px 2px; font-weight: 600; }
  th.num, td.num { text-align: right; font-family: var(--mono); }
  tbody tr { border-bottom: 1px solid var(--hair); break-inside: avoid; }
  tbody tr.line { border-bottom: 1.2px solid var(--rule); }
  tbody tr.line td { padding-top: 8px; padding-bottom: 8px; font-weight: 600; }
  td.no { font-family: var(--mono); font-size: 8.5pt; font-weight: 600; white-space: nowrap; }
  td.num { font-size: 8.5pt; font-weight: 500; white-space: nowrap; }
  .sub { color: var(--ink-soft); font-size: 7.2pt; line-height: 1.4; margin-top: 2px; font-weight: 400; }
  .chip { display: inline-flex; font-size: 6.6pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; padding: 1.5px 5px; border: 1px solid var(--rule); border-radius: 2.5px; color: var(--ink-soft); line-height: 1.2; font-family: var(--sans); }
  .chip.ok { color: var(--ok); background: var(--ok-bg); border-color: #86c79a; }
  .chip.flag { color: var(--flag); background: var(--flag-bg); border-color: #e0a3a3; }
  .chip.prov { color: var(--ink-faint); border: 1px dashed var(--rule); background: var(--wash); white-space: nowrap; font-size: 6.2pt; padding: 2px 5px; }

  .close { display: grid; grid-template-columns: minmax(0, 1fr) 82mm; gap: 8mm; align-items: start; }
  .mgmt table { table-layout: fixed; }
  .mgmt th.num, .mgmt td.num { padding-left: 2px; padding-right: 4px; }
  .mgmt td.num { font-size: 7.8pt; }
  .mgmt thead th { padding-left: 2px; padding-right: 4px; letter-spacing: .04em; white-space: normal; }
  .mgmt thead tr.band th { font-size: 5.8pt; letter-spacing: .02em; }
  .mgmt td.num .chip { white-space: normal; text-align: right; }
  .mgmt { display: flex; flex-direction: column; gap: 4mm; min-width: 0; }
  .verdict { font-size: 7.6pt; padding: 5px 7px; background: var(--wash); border-left: 2.5px solid var(--flag); line-height: 1.38; break-inside: avoid; }
  .verdict.ok { border-left-color: var(--ok); }
  .verdict.plain { border-left-color: var(--rule); }
  .verdict b { font-weight: 700; }
  .verdict + .verdict { margin-top: -2mm; }

  .spine { border-left: 2px solid var(--accent); padding-left: 9px; display: flex; flex-direction: column; gap: 6px; }
  .spine .big { font-family: var(--mono); font-size: 14pt; line-height: 1.05; letter-spacing: -.02em; font-weight: 700; }
  .spine .big em { font-style: normal; font-size: 7.5pt; color: var(--ink-soft); display: block; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 2px; font-weight: 600; font-family: var(--sans); letter-spacing: .08em; }
  .gauge { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .gauge .g .k { color: var(--ink-soft); font-size: 6.8pt; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 1px; font-weight: 600; }
  .gauge .g .v { font-family: var(--mono); font-size: 10pt; font-weight: 600; }
  .gauge.one { grid-template-columns: 1fr; }
  .bar { height: 5px; background: var(--hair); border-radius: 1px; position: relative; margin-top: 3px; }
  .bar span { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 1px; }
  .bar b { position: absolute; top: -3px; bottom: -3px; right: 0; width: 1.5px; background: var(--flag); }
  .bar.over span { background: var(--flag); }

  .totals { border-top: 1.4px solid var(--ink); padding-top: 4px; }
  .totrow { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px solid var(--hair); font-size: 8.4pt; }
  .totrow .k { color: var(--ink-soft); font-size: 8pt; }
  .totrow .k .sub { margin-left: 4px; }
  .totrow .v { font-family: var(--mono); font-weight: 500; text-align: right; min-width: 28mm; }
  .totrow .v.note { font-family: var(--sans); font-style: italic; font-size: 7.4pt; color: var(--ink-faint); }
  .totrow.strong { border-bottom: 0; border-top: 1.4px solid var(--ink); margin-top: 4px; padding-top: 5px; font-weight: 700; font-size: 9.6pt; }
  .totrow.strong .k { color: var(--ink); font-weight: 700; }
  .note { font-size: 7pt; color: var(--ink-faint); margin-top: 5px; line-height: 1.35; }

  .sigs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6mm; break-inside: avoid; }
  .sig { display: flex; flex-direction: column; }
  .sig .k { font-size: 6.8pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; min-height: 22px; display: flex; align-items: flex-end; margin-bottom: 4px; line-height: 1.25; }
  .sig .plate { height: 12mm; border-bottom: 1.2px solid var(--ink); display: flex; align-items: flex-end; padding-bottom: 2px; }
  .sig .plate img { max-height: 11mm; max-width: 100%; object-fit: contain; display: block; }
  .sig .plate .printed-name { font-family: var(--serif); font-style: italic; font-size: 11pt; }
  .sig .who { font-size: 8.4pt; font-weight: 600; margin-top: 4px; line-height: 1.2; min-height: 1.2em; }
  .sig .role { font-size: 7.1pt; color: var(--ink-soft); line-height: 1.25; margin-top: 1.5px; }
  .sig .stamp { font-family: var(--mono); font-size: 6.5pt; color: var(--ink-faint); margin-top: 3px; line-height: 1.25; }
  .sig.awaiting .plate { border-bottom-style: dashed; }
  .sig.awaiting .pending { font-family: var(--mono); font-size: 6.8pt; color: var(--flag); font-weight: 600; margin-top: 3px; }

  .foot { display: flex; justify-content: space-between; gap: 16px; border-top: 1px solid var(--hair); padding-top: 4px; font-size: 6.8pt; color: var(--ink-faint); font-family: var(--mono); margin-top: auto; }

  /* appendix */
  .appendix h3 { font-family: var(--serif); font-size: 11pt; margin: 0 0 2px; font-weight: 600; }
  .appendix h3 small { font-family: var(--mono); font-size: 7.4pt; font-weight: 400; color: var(--ink-soft); margin-left: 6px; }
  .tline { display: flex; flex-direction: column; gap: 2mm; }
  .bands { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; font-size: 6.4pt; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; border-bottom: 1.4px solid var(--ink); padding-bottom: 2px; }
  .entry { border-top: 1px solid var(--rule); padding: 4px 0 6px; display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; break-inside: avoid; }
  .entry:first-of-type { border-top: 0; }
  .entry .col .h { font-size: 6.8pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); font-weight: 600; margin-bottom: 2px; }
  .entry .col ul { margin: 0; padding-left: 12px; font-size: 7.6pt; line-height: 1.42; }
  .entry .col .src { font-size: 7.2pt; color: var(--ink-soft); margin-top: 3px; }
  .entry .none { font-style: italic; color: var(--ink-faint); font-size: 7.4pt; }
  .incl-wrap { border: 1px solid var(--hair); background: var(--wash); padding: 7px 10px 8px; border-radius: 2px; break-inside: avoid; }
  .incl-h { font-size: 6.8pt; letter-spacing: .08em; font-weight: 600; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 5px; }
  .incl-sub { font-size: 6.6pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-faint); margin: 5px 0 3px; font-weight: 600; }
  .incl { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px 14px; }
  .incl .i { font-size: 7.2pt; display: flex; gap: 5px; align-items: baseline; line-height: 1.25; }
  .incl .i i { font-style: normal; width: 8px; color: var(--ok); font-weight: 700; flex: none; font-size: 7.5pt; }
  .incl .i.missing { color: var(--flag); font-weight: 500; }
  .incl .i.missing i { color: var(--flag); }
  .incl .i.not_required { color: var(--ink-faint); }
  .incl .i.not_required i { color: var(--ink-faint); }
  .incl .i.substituted i { color: var(--ink-soft); }
  .empty { font-style: italic; color: var(--ink-faint); }
`;

// ── furniture ────────────────────────────────────────────────────────────────

const rail = (vm, sub) => `<div class="rail"><span class="mark">${MARK}</span>
    <span class="org"><b>${esc(vm.entity)}</b>Purchasing department</span>
    <span class="doc"><div class="t">Costing Matrix</div><div class="s">${esc(vm.number)} · ${esc(sub)}</div></span></div>`;

const fact = (label, value, mono = false) =>
  `<div class="fact"><span class="k">${esc(label)}</span><span class="v${mono ? ' m' : ''}">${esc(value)}</span></div>`;

function foot(vm, notes, label) {
  const printed = [vm.printedAt ? `printed ${vm.printedAt}` : null, vm.printedBy ? `by ${vm.printedBy}` : null].filter(Boolean).join(' ');
  return `<div class="foot"><span>${esc(vm.number)} · Costing Matrix${printed ? ` · ${esc(printed)}` : ''}</span><span>${esc(notes)}</span><span>${esc(label)}</span></div>`;
}

const sheetLabel = (vm, key, name) => `sheet ${vm.sheets.indexOf(key) + 1} of ${vm.sheets.length} · ${name}`;

// ── sheet 1: money ───────────────────────────────────────────────────────────

function marginStrip(strip) {
  const bar =
    strip.abcBar === null
      ? ''
      : `<div class="bar${strip.overAbc ? ' over' : ''}"><span style="width:${strip.abcBar.toFixed(1)}%"></span><b></b></div>`;
  return `<div class="spine">
    <div class="big"><em>Final offer</em>${esc(strip.finalOffer)}</div>
    <div class="gauge one"><div class="g"><div class="k">Against ABC</div><div class="v">${esc(strip.abcPercent)}</div>${bar}</div></div>
    <div class="gauge"><div class="g"><div class="k">Cost (Final Acquire)</div><div class="v">${esc(strip.cost)}</div></div>
      <div class="g"><div class="k">Landed cost</div><div class="v"><span class="chip prov">${esc(strip.landedCost)}</span></div></div></div>
    <div class="gauge"><div class="g"><div class="k">Markup target</div><div class="v">${esc(strip.target)}</div></div>
      <div class="g"><div class="k">Achieved</div><div class="v">${esc(strip.achieved)}</div></div></div>
  </div>`;
}

function summaryBlock(rows) {
  return `<div class="totals">${rows
    .map((r) => {
      const isNote = String(r.value).startsWith('Incomplete');
      return `<div class="totrow${r.strong ? ' strong' : ''}"><span class="k">${esc(r.label)}${r.hint ? `<span class="sub">${esc(r.hint)}</span>` : ''}</span><span class="v${isNote ? ' note' : ''}">${esc(r.value)}</span></div>`;
    })
    .join('')}</div>
  <div class="note">Every figure on this sheet is the bid estimate. Landed Cost replaces nothing: it prints beside these once the purchases are made.</div>`;
}

function bidDecisionBlock(bid) {
  if (!bid) return '<div class="verdict plain"><b>Bid Decision</b> · none taken yet.</div>';
  return `<div class="verdict ${bid.verdict === 'Go' ? 'ok' : ''}"><b>Bid Decision: ${esc(bid.verdict)}</b> · ${esc(bid.reason)}
    <div class="sub">Decided by ${esc(bid.decidedBy)} on ${esc(bid.decidedOn)}, against a Final Offer of ${esc(bid.finalOffer)} and an ABC of ${esc(bid.abc)}.</div></div>`;
}

function deviationBlock(money) {
  const notes = [];
  if (money.deviations.length === 0) notes.push('<div class="verdict ok"><b>No deviations.</b> Every evaluated Component complies with what was asked.</div>');
  for (const d of money.deviations) notes.push(`<div class="verdict">${esc(d.text)}</div>`);
  if (money.notEvaluated > 0) {
    notes.push(`<div class="verdict plain">${esc(String(money.notEvaluated))} ${money.notEvaluated === 1 ? 'Component has' : 'Components have'} no verdict yet.</div>`);
  }
  return notes.join('');
}

function moneyTable(money) {
  const lines = money.lines
    .map(
      (l) => `<tr class="line"><td class="no">${esc(l.number)}</td>
        <td>${esc(l.name)}<div class="sub">${esc(l.detail)}</div></td>
        <td class="num">${esc(l.abc)}</td><td class="num">${esc(l.finalOffer)}</td>
        <td class="num">${esc(l.acquire)}</td><td class="num">${esc(l.finalAcquire)}</td>
        <td class="num">${esc(l.achieved)}</td><td class="num"><span class="chip prov">${esc(l.landedCost)}</span></td></tr>`,
    )
    .join('');
  const costRows = money.costRows
    .map(
      (r) => `<tr><td class="no">${esc(r.number)}</td>
        <td>${esc(r.description)}<div class="sub">Cost only — no specification, no offer line</div></td>
        <td class="num">—</td><td class="num">—</td>
        <td class="num">${esc(r.acquire)}</td><td class="num">${esc(r.finalAcquire)}</td>
        <td class="num">${esc(r.factor)}</td><td class="num"><span class="chip prov">${esc(r.landedCost)}</span></td></tr>`,
    )
    .join('');
  const empty = money.lines.length + money.costRows.length === 0 ? '<tr><td colspan="8" class="empty">No Tender Lines yet.</td></tr>' : '';
  return `<table>
    <colgroup><col style="width:8mm"><col><col style="width:24mm"><col style="width:24mm"><col style="width:24mm"><col style="width:24mm"><col style="width:15mm"><col style="width:17mm"></colgroup>
    <thead>
      <tr class="band"><th colspan="2">&nbsp;</th><th>Client / Sales</th><th class="num">Sales</th><th class="num">Purchasing</th><th class="num">Management</th><th class="num">Automatic</th><th class="num">After purchase</th></tr>
      <tr><th>No.</th><th>Tender line · PHP</th><th class="num">ABC</th><th class="num">Final offer</th><th class="num">Acquire</th><th class="num">Final acquire</th><th class="num">Achieved</th><th class="num">Landed cost</th></tr>
    </thead>
    <tbody>${lines}${costRows}${empty}</tbody></table>`;
}

function moneySheet(vm) {
  const m = vm.money;
  return `<div class="sheet money">
    ${rail(vm, 'management sheet')}
    <div class="facts">${fact('Client', vm.clientName)}${fact('Project', vm.projectTitle)}${fact('ABC', m.facts.abc, true)}${fact('Target markup', m.facts.targetMarkup, true)}${fact('Incharge', m.facts.incharge)}</div>
    <div class="close">
      <div class="mgmt">
        ${moneyTable(m)}
        ${deviationBlock(m)}
        ${bidDecisionBlock(m.bidDecision)}
        <div class="sigs">${m.signoffs
          .map((s) => sigBlock({ role: esc(s.role), who: esc(s.who), title: esc(s.title), state: s.state, signatureBase64: s.signatureBase64, stamp: s.stamp ? esc(s.stamp) : undefined }))
          .join('')}</div>
      </div>
      <div>${marginStrip(m.strip)}${summaryBlock(m.summary)}</div>
    </div>
    ${foot(vm, 'Landed Cost provisional until purchasing marks costs complete', sheetLabel(vm, 'money', 'money'))}
  </div>`;
}

// ── sheet 2: the appendix ────────────────────────────────────────────────────

const list = (lines) => `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;

function verdictBlock(c) {
  if (c.compliance === 'complies') {
    return `<div class="verdict ok"><span class="chip ok">complies</span> ${c.note ? esc(c.note) : 'Judged against the full specification.'}</div>`;
  }
  if (c.compliance === 'deviates') {
    return `<div class="verdict"><span class="chip flag">deviates</span> ${esc(c.note ?? '')}${c.alternative ? `<div class="sub">Recommended instead: ${esc(c.alternative)}</div>` : ''}</div>`;
  }
  return '<div class="verdict plain"><span class="chip">not evaluated</span></div>';
}

function entry(line, c) {
  return `<div class="entry">
    <div class="col"><div class="h">What the client asked for</div>${list(line.specLines)}</div>
    <div class="col"><div class="h">${esc(c.number)} · what we offer${c.brand ? ` · ${esc(c.brand)}` : ''}</div>
      <div><b>${esc(c.name)}</b></div>${list(c.offerLines)}
      <div class="src">${esc([c.sourcing, c.po].filter(Boolean).join(' · '))}</div>
      ${verdictBlock(c)}</div>
  </div>`;
}

function inclusionBlock(inclusion) {
  const mark = (state) => (state === 'missing' ? '✗' : state === 'not_required' ? '–' : '✓');
  const groups = inclusion.groups
    .map(
      (g) => `${g.heading ? `<div class="incl-sub">${esc(g.heading)}</div>` : ''}<div class="incl">${g.items
        .map((i) => `<span class="i ${esc(i.state)}"><i>${mark(i.state)}</i>${esc(i.description)}${i.quantity ? ` × ${esc(i.quantity)}` : ''}</span>`)
        .join('')}</div>`,
    )
    .join('');
  return `<div class="incl-wrap"><div class="incl-h">Inclusions checked against the ask · ${esc(inclusion.owner)} · ${esc(inclusion.covered)}</div>${groups || '<div class="empty">No Inclusions listed.</div>'}</div>`;
}

function appendixLine(line) {
  const entries = line.components.length
    ? line.components.map((c) => entry(line, c)).join('')
    : `<div class="entry"><div class="col"><div class="h">What the client asked for</div>${list(line.specLines)}</div>
        <div class="col"><div class="h">What we offer</div><div class="none">No Component offered against this line yet.</div></div></div>`;
  return `<div class="tline">
    <h3>Tender line ${esc(line.number)} · ${esc(line.name)}${line.quantity ? `<small>${esc(line.quantity)}</small>` : ''}</h3>
    <div class="bands"><span>Client / Sales</span><span>Purchasing · Technical</span></div>
    ${entries}
    ${line.inclusions.map(inclusionBlock).join('')}
  </div>`;
}

function appendixSheet(vm) {
  const body = vm.appendix.lines.length ? vm.appendix.lines.map(appendixLine).join('') : '<div class="empty">No Tender Lines yet.</div>';
  return `<div class="sheet appendix">
    ${rail(vm, 'specification appendix')}
    <div class="facts">${fact('Client', vm.clientName)}${fact('Project', vm.projectTitle)}</div>
    ${body}
    ${foot(vm, 'The full specification, judged line by line. No figures.', sheetLabel(vm, 'appendix', 'specifications'))}
  </div>`;
}

// ── document ─────────────────────────────────────────────────────────────────

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
