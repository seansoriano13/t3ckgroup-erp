/**
 * The printed Technical Service Report (issue #259, spec #251): a plain A4
 * sheet that names its evidence rather than reproducing it. A pure view model
 * over a TSR record, with no I/O, so the evidence summary, failure footer and
 * signature states are unit-tested without the network. The document
 * (tsrDocument.js) draws it.
 *
 *   Facts     item, the Transmittal and line it follows, SOR and PO, checked by and when
 *   Units     one row per unit: serial, verdict, remark (a failed unit's in full)
 *   Evidence  what exists, e.g. "4 photographs, 1 video (00:42)", held in the ERP
 *   Footer    "N units failed of M", only when a unit failed
 *   Signers   Checked by, and the optional Noted by (purchasing)
 *
 * A plate is `signed` (name and stamp) or `waiting` (blank), as on the paper.
 */

import { printDate, printDateTime } from './ipasViewModel';

const BLANK = '—';

/** A signature plate for the TSR: waiting (no name or no time) prints blank; signed prints the name and its stamp. */
export function tsrPlate(role, { who = null, at = null } = {}) {
  if (!who || !at) return { role, state: 'waiting', who: '', stamp: '' };
  const when = printDateTime(at);
  return { role, state: 'signed', who, stamp: when ? `signed ${when}` : 'signed' };
}

/** "4 photographs, 1 video (00:42)": what the ERP holds for the TSR. The videos never print. */
export function evidenceSummary(evidence = []) {
  const pictures = evidence.filter((e) => e.kind === 'picture').length;
  const videos = evidence.filter((e) => e.kind === 'video');
  const parts = [];
  if (pictures) parts.push(`${pictures} ${pictures === 1 ? 'photograph' : 'photographs'}`);
  if (videos.length) {
    const one = videos.length === 1 && videos[0].durationSec != null ? ` (${formatDuration(videos[0].durationSec)})` : '';
    parts.push(`${videos.length} ${videos.length === 1 ? 'video' : 'videos'}${one}`);
  }
  return parts.length ? `${parts.join(', ')}, held in the ERP` : 'No photographs or videos held';
}

/** Seconds as m:ss or h:mm:ss, the way a video length reads. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds)));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** The failure footer, or null when nothing failed (an all-Pass TSR prints no failure line). */
export function failureFooter(units = []) {
  const failed = units.filter((u) => u.verdict === 'fail').length;
  if (failed === 0) return null;
  return `${failed} ${failed === 1 ? 'unit' : 'units'} failed of ${units.length}`;
}

/** One unit row: serial, verdict and remark. A failed unit keeps its remark in full. */
function unitRow(unit) {
  return {
    serial: unit.serial || BLANK,
    verdict: unit.verdict === 'fail' ? 'Fail' : 'Pass',
    failed: unit.verdict === 'fail',
    remark: unit.remark || '',
  };
}

/** The TSR as the paper prints it. `tsr` is the record the screen or the fetch builds. */
export function buildTsrViewModel(tsr) {
  const units = (tsr.units ?? []).map(unitRow);
  const evidence = tsr.evidence ?? [];
  return {
    number: tsr.number,
    facts: {
      item: tsr.item || BLANK,
      transmittal: tsr.transmittal?.number || BLANK,
      line: tsr.line?.position != null ? `Line ${tsr.line.position}${tsr.line.description ? ` · ${tsr.line.description}` : ''}` : BLANK,
      sor: tsr.sor || BLANK,
      po: tsr.po || BLANK,
      checkedBy: tsr.checkedBy?.name || BLANK,
      checkedAt: printDate(tsr.checkedBy?.at) || BLANK,
      remarks: tsr.remarks || BLANK,
    },
    units,
    evidence: {
      summary: evidenceSummary(evidence),
      pictures: evidence.filter((e) => e.kind === 'picture'),
    },
    failure: failureFooter(tsr.units ?? []),
    signatures: {
      checkedBy: tsrPlate('Checked by', { who: tsr.checkedBy?.name ?? null, at: tsr.checkedBy?.at }),
      notedBy: tsr.notedBy ? tsrPlate('Noted by', { who: tsr.notedBy.name ?? null, at: tsr.notedBy.at }) : null,
    },
    printedOn: printDate(tsr.printedAt ?? null),
  };
}
