import { formatEntryDate, formatEntryTime } from './entryFormat.js';
import { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { MEETING_STATUS_LABEL } from '@/services/meetingRequestService';

/** Meeting details are visible to everyone: Venue, Facilitator, Participants, Guests, purpose and stage. */
export default function MeetingDetail({ entry }) {
  const person = entry.employee ?? {};
  const d = entry.details ?? {};
  const participants = d.participants ?? [];
  const guests = d.guests ?? [];
  return (
    <SlideOverBody>
      <DetailSection title="Requested by">
        <PersonChip person={{ id: person.id, name: person.name, dept: person.department, avatarPath: person.avatar }} />
      </DetailSection>
      <DetailSection title="Meeting">
        <dl>
          <DetailRow label="Purpose">{d.purpose}</DetailRow>
          <DetailRow label="Venue">{d.venue ?? entry.venue}</DetailRow>
          <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
          <DetailRow label="Time">{formatEntryTime(entry)}</DetailRow>
          <DetailRow label="Stage">{MEETING_STATUS_LABEL[d.stage] ?? d.stage}</DetailRow>
          <DetailRow label="Facilitator">{d.facilitator?.name}</DetailRow>
          <DetailRow label="Participants">{participants.length ? participants.map((p) => p.name).join(', ') : 'None'}</DetailRow>
          <DetailRow label="Guests">{guests.length ? guests.join(', ') : 'None'}</DetailRow>
        </dl>
      </DetailSection>
    </SlideOverBody>
  );
}
