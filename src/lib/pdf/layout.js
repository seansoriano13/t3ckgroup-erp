/**
 * Pure functions for PDF layout, resolving categories, and sheet composition.
 * No I/O.
 */

export function resolveLeaveCategory(record) {
  // The record's own category (joined from hr_leave_categories, ticket #64)
  // is authoritative — a hardcoded record.type/leave_type map would bypass
  // whatever HR actually configured and revive the leave-type constants #64
  // retired.
  if (record.category?.label) return record.category.label;
  if (record.type === 'OVERTIME') return 'Overtime';
  if (record.type === 'OFFSET') return 'Offset';
  if (record.type === 'SIL') return 'Service Incentive Leave';
  return 'Unknown';
}

/**
 * A record predates the signing feature (ticket #66) only when it has no
 * employee_signature_timestamp — not merely because it's approved. Reading
 * the wrong column name here (`employee_signature_date`, which never
 * existed) previously made every approved record look legacy regardless of
 * whether it was actually digitally signed.
 */
export function isLegacySignature(record) {
  return Boolean(record.status?.startsWith('APPROVED') && !record.employee_signature_timestamp);
}

/**
 * Shortens a UUID record id to something that fits the printed "RECORD NO."
 * field without overrunning into the QR code beside it — the full 36-char
 * UUID doesn't fit in the space designed for a short sequential number.
 */
export function formatRecordNumber(id) {
  if (!id) return '------';
  return id.toString().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function isLateFiling(record) {
  if (!record.created_at || !record.startDate) return false;
  // Late if created_at date part is strictly after the start date part
  const createdDateStr = record.created_at.split('T')[0];
  const startDateStr = record.startDate.split('T')[0];
  
  return createdDateStr > startDateStr;
}

export function getInclusiveDates(record) {
  if (!record.startDate) return '';
  if (record.startDate === record.endDate || !record.endDate) {
    return new Date(record.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const start = new Date(record.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const end = new Date(record.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `${start} — ${end}`;
}

export function getDayCount(record) {
  if (record.dayCount) return record.dayCount;
  if (!record.startDate || !record.endDate) return 1;
  const start = new Date(record.startDate);
  const end = new Date(record.endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
  return diffDays + 1;
}

/**
 * Splits an array of records into a nested array of sheets (max 2 records per sheet).
 * Never mixes leave (TG-11) and overtime (TG-12) on the same sheet.
 * Odd counts result in one record on the sheet (which the renderer prints with a blank second half).
 */
export function composeSheets(records) {
  const leaves = [];
  const overtimes = [];
  
  for (const record of records) {
    if (record.type === 'OVERTIME') {
      overtimes.push(record);
    } else {
      leaves.push(record);
    }
  }
  
  const sheets = [];
  
  // Chunk leaves into pairs
  for (let i = 0; i < leaves.length; i += 2) {
    sheets.push(leaves.slice(i, i + 2));
  }
  
  // Chunk overtimes into pairs
  for (let i = 0; i < overtimes.length; i += 2) {
    sheets.push(overtimes.slice(i, i + 2));
  }
  
  return sheets;
}

/**
 * A dummy record carrying only the type the renderer needs to draw a blank
 * half-sheet — used to fill the spare half of a sheet when an odd number of
 * records is being printed.
 */
export function getBlankHalfRecord(type) {
  return { type };
}

export function getOvertimeOutcome(status) {
  if (status === 'APPROVED_PAID') return 'PAID OVERTIME';
  if (status === 'APPROVED_OFFSET') return 'OFFSET CREDIT';
  if (status === 'REJECTED') return 'REJECTED';
  return 'PENDING';
}

export function getOvertimeHoursDisplay(record) {
  const reqHours = record.requested_hours || record.hours || 0;
  // A null approved_hours (rejected or legacy record) is "no override to
  // show," not a real number to strike the requested hours through against.
  const hasOverride = record.approved_hours !== undefined && record.approved_hours !== null;
  const appHours = hasOverride ? record.approved_hours : reqHours;

  return {
    requested: reqHours,
    approved: appHours,
    isDifferent: hasOverride && reqHours !== appHours
  };
}
