import { formatEntryDate, formatEntryTime } from './entryFormat.js';
import SlideOver, { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { kindOf } from './entryKinds.jsx';

const STATUS_LABEL = { APPROVED: 'Approved', PENDING: 'Pending' };

/** The shared body: who, when, status, hours, venue, and the reason only when the server sent one. */
export function DefaultEntryDetail({ entry }) {
  const person = entry.employee ?? {};
  const reason = entry.details?.reason;
  return (
    <SlideOverBody>
      <DetailSection title="Who">
        <PersonChip person={{ id: person.id, name: person.name, dept: person.department, avatarPath: person.avatar }} />
      </DetailSection>
      <DetailSection title="Details">
        <dl>
          <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
          <DetailRow label="Time">{formatEntryTime(entry)}</DetailRow>
          <DetailRow label="Status">{STATUS_LABEL[entry.status] ?? entry.status}</DetailRow>
          {entry.hours != null && <DetailRow label="Hours">{Number(entry.hours)}</DetailRow>}
          {entry.venue && <DetailRow label="Venue">{entry.venue}</DetailRow>}
          {reason && <DetailRow label="Reason">{reason}</DetailRow>}
        </dl>
      </DetailSection>
    </SlideOverBody>
  );
}

/** The detail panel for one Calendar entry; each kind may supply its own body in the registry. */
export default function EntryDetail({ entry, onClose }) {
  return (
    <SlideOver
      record={entry}
      icon={entry ? kindOf(entry.kind)?.icon : undefined}
      crumb="Calendar"
      identity={(e) => ({
        ref: kindOf(e.kind)?.label ?? e.kind,
        title: e.title || kindOf(e.kind)?.label || e.kind,
        subtitle: e.employee?.name,
      })}
      onClose={onClose}
    >
      {(e) => {
        const Body = kindOf(e.kind)?.Detail ?? DefaultEntryDetail;
        return <Body entry={e} />;
      }}
    </SlideOver>
  );
}
