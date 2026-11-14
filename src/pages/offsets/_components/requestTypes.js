import { ENTRY_KINDS } from '../../../components/calendar/entryKinds';

/** How each request type reads in My Requests: its name and badge colours. Owned by the Calendar's entry kinds. */
export const REQUEST_TYPE_BADGE = Object.fromEntries(
  ['OFFSET', 'SIL', 'LWOP', 'OVERTIME', 'UNDERTIME'].map((t) => [t, { label: ENTRY_KINDS[t].label, badgeClass: ENTRY_KINDS[t].chip }]),
);
