import { useMemo, useState } from 'react';
import { useRecordParam } from '../../../../hooks/useRecordParam';
import { recordKey } from './leaveDisplay';

const PERSON_PREFIX = 'person:';

/** `?record=` holds a request's key, or `person:<employee id>` for a balance profile. */
export const personRecordId = (employeeId) => PERSON_PREFIX + employeeId;

export function parseRecordId(recordId) {
  if (!recordId) return null;
  return recordId.startsWith(PERSON_PREFIX)
    ? { kind: 'person', employeeId: recordId.slice(PERSON_PREFIX.length) }
    : { kind: 'request', key: recordId };
}

/**
 * The Leaves Manager's slide-over: which request or balance profile is open
 * (kept in the URL by useRecordParam), the list its arrows step through, and
 * where Close goes.
 *
 * A request opened from a list steps through that list; one opened from a
 * shared link or refresh steps through the view it belongs to. A request
 * opened from a profile closes back to that profile.
 *
 * `requests` is every loaded request, pending and decided. A decided request
 * outside the loaded month is not in it, so its link opens nothing until that
 * month is picked (pending requests are dateless and always load).
 */
export function useLeaveSheet({ requests, employeeBalances, pendingView, historyView }) {
  const { recordId, open, step, close } = useRecordParam();
  // { keys: the list it was opened from, personId: the profile it came from }
  const [origin, setOrigin] = useState(null);

  const parsed = parseRecordId(recordId);
  const request = parsed?.kind === 'request' ? requests.find((r) => recordKey(r) === parsed.key) || null : null;
  const person = parsed?.kind === 'person' ? employeeBalances.find((e) => e.id === parsed.employeeId) || null : null;

  // Ignore an origin left over from some other request.
  const from = request && origin?.keys.includes(recordId) ? origin : null;
  const returnTo = from?.personId ? employeeBalances.find((e) => e.id === from.personId) || null : null;

  const stepList = useMemo(() => {
    if (!request) return [];
    if (from) {
      const byKey = new Map(requests.map((r) => [recordKey(r), r]));
      return from.keys.map((k) => byKey.get(k)).filter(Boolean);
    }
    const view = request.status === 'PENDING' ? pendingView : historyView;
    return view.some((r) => recordKey(r) === recordId) ? view : [request];
  }, [request, from, requests, pendingView, historyView, recordId]);
  const stepIndex = stepList.findIndex((r) => recordKey(r) === recordId);

  const crumb = returnTo ? returnTo.name : request?.status === 'PENDING' ? 'Pending' : 'Request History';

  return {
    request,
    person,
    stepList,
    stepIndex,
    crumb,
    /** The view the open record belongs to, for a shared link to land on. */
    view: person ? 'balances' : request ? (request.status === 'PENDING' ? 'pending' : 'history') : null,
    openRequest: (target, list, { fromPersonId = null } = {}) => {
      setOrigin({ keys: list.map(recordKey), personId: fromPersonId });
      open(recordKey(target));
    },
    openPerson: (employeeId) => open(personRecordId(employeeId)),
    stepBy: (delta) => {
      const to = stepList[stepIndex + delta];
      if (to) step(recordKey(to));
    },
    /** Close a request: back to the profile it came from, else shut. */
    closeRequest: () => (returnTo ? step(personRecordId(returnTo.id)) : close()),
    close,
  };
}
