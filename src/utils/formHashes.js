/**
 * Formats a number the same way on both sides of the hash comparison: a JS
 * float sum (e.g. 16.000000000000004 from repeated addition) and a Postgres
 * NUMERIC column holding the same logical value (e.g. 16.00) must produce the
 * identical string, or an untampered record hashes as invalid. Rounds to 2
 * decimal places, then strips a trailing ".00"/".50" the way Postgres's own
 * trim_scale() does — the RPC's canonicalization mirrors this exactly.
 * Returns '' for null/undefined so a legitimately absent value (e.g. a
 * rejection's null credits snapshot) never becomes the string "NaN".
 */
export function canonicalNumber(value) {
  if (value === null || value === undefined || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(num)) return '';
  return num.toFixed(2).replace(/\.?0+$/, '') || '0';
}

/**
 * Generates a SHA-256 hash for a given string payload.
 * Runs in browser contexts using crypto.subtle.
 */
export async function generateHash(dataString) {
  const encoder = new TextEncoder();
  const data = encoder.encode(dataString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates the application hash for leave/overtime forms.
 * @param {Object} params
 * @param {string} params.employeeId
 * @param {string} params.categoryId
 * @param {string|string[]} params.dates
 * @param {number|string} params.totalHours
 * @param {string} params.reason
 */
export async function generateApplicationHash({ employeeId, categoryId, dates, totalHours, reason }) {
  const datesString = Array.isArray(dates) ? [...dates].sort().join(',') : dates;
  const payload = `${employeeId}|${categoryId || ''}|${datesString}|${canonicalNumber(totalHours)}|${reason || ''}`;
  return generateHash(payload);
}

/**
 * Generates the approval hash for leave/overtime forms.
 * @param {Object} params
 * @param {string} params.applicationHash
 * @param {string} params.status
 * @param {string} params.approverId
 * @param {number|string} params.creditsSnapshot
 */
export async function generateApprovalHash({ applicationHash, status, approverId, creditsSnapshot }) {
  const payload = `${applicationHash}|${status}|${approverId || ''}|${canonicalNumber(creditsSnapshot)}`;
  return generateHash(payload);
}
