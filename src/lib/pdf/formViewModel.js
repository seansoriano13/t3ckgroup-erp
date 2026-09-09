/**
 * Pure mapping from a raw offset/SIL/overtime record (plus HR form settings)
 * to exactly the fields TG-11 and TG-12 print. No I/O, no pdf-lib — every
 * value here is either read straight off the record or derived from it, so
 * a form never shows a fact the record can't back up.
 */

import { resolveLeaveCategory, getInclusiveDates, getDayCount, isLateFiling, isLegacySignature, getOvertimeOutcome, getOvertimeHoursDisplay } from './layout';

/** "LV-2026-4F91" / "OT-2026-4F91" / "UT-2026-4F91" — stable per record, never a claimed sequence number. */
export function getRecordNumber(record) {
  const prefix = record.type === 'OVERTIME' ? 'OT' : record.type === 'UNDERTIME' ? 'UT' : 'LV';
  const year = record.created_at ? new Date(record.created_at).getUTCFullYear() : new Date().getUTCFullYear();
  const suffix = (record.id || '').replace(/-/g, '').slice(0, 4).toUpperCase() || '0000';
  return `${prefix}-${year}-${suffix}`;
}

/** Which balance a leave/Offset application draws from. */
export function getTreatedAs(record) {
  if (record.type === 'SIL') return 'Service Incentive Leave';
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
 *  - 'wet': the role never signs digitally in this system (supervisor, approver) — always a blank ruled line
 */
function employeeSigBlock(record) {
  if (record.employee_signature_timestamp) {
    return {
      role: 'Employee', who: record.employee?.name || 'Unknown', title: 'Applicant',
      state: 'signed',
      signaturePath: record.employee_signature_version,
      stamp: getSignedStamp(record.employee_signature_timestamp, record.employee_signature_version),
    };
  }
  if (isLegacySignature(record)) {
    return { role: 'Employee', who: record.employee?.name || 'Unknown', title: 'Applicant', state: 'legacy' };
  }
  return { role: 'Employee', who: record.employee?.name || 'Unknown', title: 'Applicant', state: 'wet' };
}

function approverSigBlock(record, formSettings) {
  const who = formSettings?.approver_name || record.hr?.name || 'Approving officer';
  const isSigned = record.approval_hash || record.hr_signature_version;
  
  if (record.hr_signature_timestamp) {
    return {
      role: 'Approved by', who, title: formSettings?.approver_title || 'Approving officer',
      state: 'signed',
      signaturePath: record.hr_signature_version,
      stamp: getSignedStamp(record.hr_signature_timestamp, record.hr_signature_version),
    };
  }
  
  if (isSigned) {
    // Has a valid approval hash but no signature timestamp fetched or legacy
    return {
      role: 'Approved by', who, title: formSettings?.approver_title || 'Approving officer',
      state: 'signed',
      signaturePath: null,
      stamp: 'Approved electronically',
    };
  }

  return { role: 'Approved by', who, title: formSettings?.approver_title || 'Approving officer', state: 'wet' };
}

/**
 * Department-head approval stage (issue #137). Only appears when the
 * request was actually routed to a head — legacy/backfilled rows have no
 * head_id and print nothing here, same as supervisorSigBlock's opt-in shape.
 */
function headSigBlock(record) {
  if (!record.head_id) return null;
  const who = record.head?.name || 'Department Head';
  if (record.head_status === 'REJECTED') {
    return { role: 'Department Head', who, title: 'Head', state: 'wet', note: 'Rejected' };
  }
  if (record.head_decided_at) {
    return {
      role: 'Department Head', who, title: 'Head',
      state: 'signed',
      signaturePath: record.head_signature_version,
      stamp: getSignedStamp(record.head_decided_at, record.head_signature_version),
    };
  }
  return { role: 'Department Head', who, title: 'Head', state: 'wet', note: 'Pending' };
}

function supervisorSigBlock(formSettings) {
  if (!formSettings?.supervisor_name) return null;
  return {
    role: 'Noted by',
    who: formSettings.supervisor_name,
    title: formSettings?.supervisor_title || 'Supervisor / Manager',
    state: 'wet'
  };
}

/** Fields common to both templates' right-rail "HRD validation" block. */
function hrdValidationRows(record, balanceLabel) {
  return [
    ['Validated by', record.hr?.name || '—'],
    ['Validation date', record.hr_processed_at || record.updated_at
      ? new Date(record.hr_processed_at || record.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—'],
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
    ['Validation date', record.hr_processed_at
      ? new Date(record.hr_processed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—'],
    ['Filed', getFiledStatus(record)],
  ];
}

export function buildTG11ViewModel(record, formSettings) {
  const fields = [
    { k: 'Date filed', v: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Employment status', v: record.employee?.employment_status || '—' },
    { k: 'Category', v: resolveLeaveCategory(record) },
    { k: 'Inclusive dates', v: getInclusiveDates(record), x: `${getDayCount(record)} day${getDayCount(record) > 1 ? 's' : ''}` },
    { k: 'Treated as', v: getTreatedAs(record) },
  ];

  return {
    recordNo: getRecordNumber(record),
    kind: 'Application for Leave',
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
    sigs: [
      employeeSigBlock(record),
      headSigBlock(record),
      supervisorSigBlock(formSettings),
    ].filter(Boolean),
    note: 'This form must be filed before the leave commences, or immediately upon return for emergency or sick leave.',
    verificationToken: record.verification_token,
  };
}

export function buildTG12ViewModel(record, formSettings) {
  const fields = [
    { k: 'Date filed', v: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Date of overtime', v: record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Employment status', v: record.employee?.employment_status || '—' },
    { k: 'Time window', v: (record.start_time && record.end_time) ? `${record.start_time} – ${record.end_time}` : '—' },
  ];

  const { requested, approved, isDifferent } = getOvertimeHoursDisplay(record);

  return {
    recordNo: getRecordNumber(record),
    kind: 'Overtime Authorization',
    name: record.employee?.name || 'Unknown',
    meta: [record.employee?.role, record.employee?.department, record.employee?.sub_department].filter(Boolean).join(' · '),
    company: record.company?.name || null,
    bigK: 'Hours approved',
    bigN: trimNumber(approved),
    bigU: 'hrs',
    requestedHours: isDifferent ? trimNumber(requested) : null,
    fields,
    outcome: getOvertimeOutcome(record.status),
    remK: 'Notice of overtime',
    rem: [record.reason, record.hr_notes ? `HR Note: ${record.hr_notes}` : null].filter(Boolean).join('\n\n') || '',
    hrd: hrdValidationRows(record, 'Offset balance'),
    sigs: [
      employeeSigBlock(record),
      headSigBlock(record),
      supervisorSigBlock(formSettings),
      approverSigBlock(record, formSettings),
    ].filter(Boolean),
    note: 'File a day before scheduled overtime, or as soon as possible afterward if unscheduled.',
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
export function buildTG13ViewModel(record, formSettings) {
  const fields = [
    { k: 'Date filed', v: record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Date of undertime', v: record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—' },
    { k: 'Employment status', v: record.employee?.employment_status || '—' },
    { k: 'Original work schedule', v: (record.original_start_time && record.original_end_time) ? `${record.original_start_time} – ${record.original_end_time}` : '—' },
    { k: 'Actual work schedule', v: (record.actual_start_time && record.actual_end_time) ? `${record.actual_start_time} – ${record.actual_end_time}` : '—' },
  ];

  const approvedHours = record.approved_hours ?? record.hours ?? 0;

  return {
    recordNo: getRecordNumber(record),
    kind: 'Undertime',
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
    sigs: [
      employeeSigBlock(record),
      headSigBlock(record),
      supervisorSigBlock(formSettings),
      approverSigBlock(record, formSettings),
    ].filter(Boolean),
    note: 'File as soon as the shortfall against the scheduled work window is known.',
    verificationToken: record.verification_token,
  };
}
