/**
 * Pure mapping from a raw offset/SIL/overtime/undertime record to exactly
 * the fields TG-11, TG-12 and TG-13 print. No I/O, no pdf-lib — every value
 * here is either read straight off the record or derived from it, so a
 * form never shows a fact the record can't back up.
 */

import { formatManilaDate, formatManilaDateTime } from '../manilaDate';
import { getInclusiveDates, getDayCount, isLateFiling, isLegacySignature, getOvertimeHoursDisplay } from './layout';

/** One record number prefix per record type — the single source the registry (formTypeRegistry.js) draws its label from. */
const RECORD_PREFIXES = { OVERTIME: 'OT', UNDERTIME: 'UT', SIL: 'LV', OFFSET: 'LV' };

/** "LV-2026-4F91" / "OT-2026-4F91" / "UT-2026-4F91" — stable per record, never a claimed sequence number. */
export function getRecordNumber(record) {
  const prefix = RECORD_PREFIXES[record.type];
  if (!prefix) throw new Error(`Unknown form record type: "${record.type}"`);
  const year = record.created_at ? new Date(record.created_at).getUTCFullYear() : new Date().getUTCFullYear();
  const suffix = (record.id || '').replace(/-/g, '').slice(0, 4).toUpperCase() || '0000';
  return `${prefix}-${year}-${suffix}`;
}

/** Which balance a leave/Offset application draws from. */
export function getTreatedAs(record) {
  if (record.type === 'SIL') return 'Leave With Pay (LWP)';
  if (record.type === 'OFFSET') return 'Offset';
  return 'Unknown';
}

/**
 * "23.5 → 15.5 hrs remaining" for a leave/Offset deduction. The prior
 * balance is derived arithmetically from the post-approval snapshot plus
 * what the approval moved — never a second stored figure that could drift
 * from the snapshot #73 fixed.
 */
export function getBalanceLedger(record) {
  const snapshot = record.approval_credits_snapshot;
  if (snapshot === null || snapshot === undefined) return null;
  const moved = Number(record.hours) || 0;
  const prior = Number(snapshot) + moved;
  return `${trimNumber(prior)} → ${trimNumber(snapshot)} hrs remaining`;
}

function trimNumber(n) {
  const num = Number(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/** "On time" / "Late filing" — reuses the same lateness rule the layout module already enforces. */
export function getFiledStatus(record) {
  return isLateFiling(record) ? 'Late filing' : 'On time';
}

/** A short, stable fragment of the stored signature path — not a claimed version counter. */
export function getShortSigId(signaturePath) {
  if (!signaturePath) return null;
  const stripped = signaturePath.replace(/[^a-zA-Z0-9]/g, '');
  return stripped.slice(-6).toLowerCase();
}

/** "e-signed Aug 26, 2026 · 09:14 · sig a1b2c3" for a genuinely digitally-signed plate. */
export function getSignedStamp(timestamp, signaturePath) {
  if (!timestamp) return null;
  const d = new Date(timestamp);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sigId = getShortSigId(signaturePath);
  return `e-signed ${date} · ${time}${sigId ? ` · sig ${sigId}` : ''}`;
}

/**
 * One signature-plate description. `state` is one of:
 *  - 'signed': a real digital signature exists, embed the image
 *  - 'legacy': predates the signing feature, print "signed on paper"
 *  - 'wet': no digital signature to show — a blank ruled line, either
 *    because this role never signs digitally, or because the decision this
 *    plate represents (head approval, HR processing) hasn't happened yet
 */
function requestedBySigBlock(record) {
  if (record.employee_signature_timestamp) {
    return {
      role: 'Requested by', who: record.employee?.name || 'Unknown', title: 'Applicant',
      state: 'signed',
      signaturePath: record.employee_signature_version,
      stamp: getSignedStamp(record.employee_signature_timestamp, record.employee_signature_version),
    };
  }
  if (isLegacySignature(record)) {
    return { role: 'Requested by', who: record.employee?.name || 'Unknown', title: 'Applicant', state: 'legacy' };
  }
  return { role: 'Requested by', who: record.employee?.name || 'Unknown', title: 'Applicant', state: 'wet' };
}

/**
 * The department head who approved the request (issue #137's head stage,
 * issue #153's real "Approved by" plate). Never omitted: a record with no
 * head_id at all — either it predates the head stage, or a head was never
 * routed — still prints this plate, as a blank ruled line captioned
 * "Approved by", exactly like a decision that simply hasn't happened yet.
 */
function approvedBySigBlock(record) {
  if (!record.head_id) {
    return { role: 'Approved by', who: '', title: 'Department Head', state: 'wet' };
  }
  const who = record.head?.name || 'Department Head';
  if (record.head_status === 'REJECTED') {
    return { role: 'Approved by', who, title: 'Department Head', state: 'wet', note: 'Rejected' };
  }
  if (record.head_decided_at) {
    return {
      role: 'Approved by', who, title: 'Department Head',
      state: 'signed',
      signaturePath: record.head_signature_version,
      stamp: getSignedStamp(record.head_decided_at, record.head_signature_version),
    };
  }
  return { role: 'Approved by', who, title: 'Department Head', state: 'wet', note: 'Pending' };
}

/**
 * The HR officer who processed the request (`hr_processed_by`), replacing
 * the typed-name settings singleton issue #153 removes. Never omitted: an
 * unprocessed record prints a blank ruled line captioned "Noted by" rather
 * than vanishing the column, which is exactly the bug this plate replaces.
 */
function notedBySigBlock(record) {
  const who = record.hr?.name || '';
  if (record.hr_signature_timestamp) {
    return {
      role: 'Noted by', who, title: 'HR Officer',
      state: 'signed',
      signaturePath: record.hr_signature_version,
      stamp: getSignedStamp(record.hr_signature_timestamp, record.hr_signature_version),
    };
  }
  const isSigned = record.approval_hash || record.hr_signature_version;
  if (isSigned) {
    // Has a valid approval hash but no signature timestamp fetched or legacy
    return { role: 'Noted by', who, title: 'HR Officer', state: 'signed', signaturePath: null, stamp: 'Approved electronically' };
  }
  return { role: 'Noted by', who, title: 'HR Officer', state: 'wet' };
}

/**
 * The one signature band every form prints, in the fixed order the paper
 * TG-13 already uses: Requested by, Approved by, Noted by. Always exactly
 * three plates — an undecided plate renders as a ruled line rather than
 * being omitted, so the form's shape never depends on what's been decided.
 */
function buildSignatureBand(record) {
  return [
    requestedBySigBlock(record),
    approvedBySigBlock(record),
    notedBySigBlock(record),
  ];
}

/**
 * When HR validated the record. Fallback order: hr_processed_at (date and
 * time), hr_signature_timestamp (date and time), then updated_at (date only,
 * since it moves whenever the row changes and its time cannot be trusted).
 */
export function getValidationStamp(record) {
  if (record.hr_processed_at) return formatManilaDateTime(record.hr_processed_at);
  if (record.hr_signature_timestamp) return formatManilaDateTime(record.hr_signature_timestamp);
  if (record.updated_at) return formatManilaDate(record.updated_at);
  return '�';
}

/** Fields common to both templates' right-rail "HRD validation" block. */
function hrdValidationRows(record, balanceLabel) {
  return [
    ['Validated by', record.hr?.name || '—'],
    ['Validation date', getValidationStamp(record)],
    [balanceLabel, record.approval_credits_snapshot !== null && record.approval_credits_snapshot !== undefined
      ? `${trimNumber(record.approval_credits_snapshot)} hrs` : '—'],
    ['Filed', getFiledStatus(record)],
  ];
}

/**
 * TG-13's own validation block, distinct from hrdValidationRows above: no
 * balance/credits row at all, since undertime never moves one, and
 * `hr_processed_at` is read directly rather than falling back to
 * `updated_at` — undertime carries the real column from day one (see
 * 20260909010000_undertime_requests.sql), so the fallback that papers over
 * overtime/offset lacking it would only hide a bug here.
 */
function undertimeValidationRows(record) {
  return [
    ['Validated by', record.hr?.name || '—'],
    ['Validation date', getValidationStamp(record)],
    ['Filed', getFiledStatus(record)],
  ];
}

export function buildTG11ViewModel(record) {
  const fields = [
    { k: 'Date filed', v: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Inclusive dates', v: getInclusiveDates(record), x: `${getDayCount(record)} day${getDayCount(record) > 1 ? 's' : ''}` },
    { k: 'Treated as', v: getTreatedAs(record) },
  ];

  return {
    recordNo: getRecordNumber(record),
    formLabel: 'TG-11',
    kind: 'Application for Leave / Offset Form',
    name: record.employee?.name || 'Unknown',
    meta: [record.employee?.role, record.employee?.department, record.employee?.sub_department].filter(Boolean).join(' · '),
    company: record.company?.name || null,
    bigK: 'Hours applied',
    bigN: trimNumber(record.hours || 0),
    bigU: 'hrs',
    ledger: getBalanceLedger(record),
    fields,
    outcome: record.status === 'APPROVED' ? 'Approved' : record.status,
    remK: 'Remarks',
    rem: [record.reason, record.hr_notes ? `HR Note: ${record.hr_notes}` : null].filter(Boolean).join('\n\n') || '',
    hrd: hrdValidationRows(record, 'Credits remaining'),
    sigs: buildSignatureBand(record),
    note: 'This form must be filed at least two (2) days before the leave commences, or immediately upon return for emergency or sick leave.',
    verificationToken: record.verification_token,
  };
}

export function buildTG12ViewModel(record) {
  const fields = [
    { k: 'Date filed', v: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Date of overtime', v: record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Time window', v: (record.start_time && record.end_time) ? `${record.start_time} – ${record.end_time}` : '—' },
  ];

  const { requested, approved, isDifferent } = getOvertimeHoursDisplay(record);

  return {
    recordNo: getRecordNumber(record),
    formLabel: 'TG-12',
    kind: 'Overtime Authorization Form',
    name: record.employee?.name || 'Unknown',
    meta: [record.employee?.role, record.employee?.department, record.employee?.sub_department].filter(Boolean).join(' · '),
    company: record.company?.name || null,
    bigK: 'Hours approved',
    bigN: trimNumber(approved),
    bigU: 'hrs',
    requestedHours: isDifferent ? trimNumber(requested) : null,
    fields,
    remK: 'Notice of overtime',
    rem: [record.reason, record.hr_notes ? `HR Note: ${record.hr_notes}` : null].filter(Boolean).join('\n\n') || '',
    hrd: hrdValidationRows(record, 'Offset balance'),
    sigs: buildSignatureBand(record),
    note: 'This form must be filed a day before the scheduled OT, or at least four (4) hours in advance in the case of unscheduled OT.',
    verificationToken: record.verification_token,
  };
}

/**
 * TG-13 — Undertime (issues #147-149). Mirrors buildTG12ViewModel's shape,
 * with two deliberate differences: the HRD block reads `hr_processed_at`
 * directly (undertime carries the real column from day one, unlike
 * overtime/offset which fall back to `updated_at`) and drops the balance
 * row entirely — undertime never credits or debits a balance, so there is
 * no figure to print there.
 */
export function buildTG13ViewModel(record) {
  const fields = [
    { k: 'Date filed', v: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Date of undertime', v: record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Original work schedule', v: (record.original_start_time && record.original_end_time) ? `${record.original_start_time} – ${record.original_end_time}` : '—' },
    { k: 'Actual work schedule', v: (record.actual_start_time && record.actual_end_time) ? `${record.actual_start_time} – ${record.actual_end_time}` : '—' },
  ];

  const approvedHours = record.approved_hours ?? record.hours ?? 0;

  return {
    recordNo: getRecordNumber(record),
    formLabel: 'TG-13',
    kind: 'Undertime Request Form',
    name: record.employee?.name || 'Unknown',
    meta: [record.employee?.role, record.employee?.department, record.employee?.sub_department].filter(Boolean).join(' · '),
    company: record.company?.name || null,
    bigK: 'Total no. of hours',
    bigN: trimNumber(approvedHours),
    bigU: 'hrs',
    fields,
    outcome: record.status === 'APPROVED' ? 'Approved' : record.status,
    remK: 'Purpose',
    rem: [record.reason, record.hr_notes ? `HR Note: ${record.hr_notes}` : null].filter(Boolean).join('\n\n') || '',
    // No balance row: undertime never credits or debits offset_hours_balance
    // or sil_hours_balance, on any status.
    hrd: undertimeValidationRows(record),
    sigs: buildSignatureBand(record),
    note: 'File as soon as the shortfall against the scheduled work window is known.',
    verificationToken: record.verification_token,
  };
}
