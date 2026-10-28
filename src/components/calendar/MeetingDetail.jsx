import { formatEntryDate, formatEntryTime } from './entryFormat.js';
import { ExternalLink } from '@/components/ui/external-link';
import { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { MEETING_STATUS_LABEL, MEETING_TYPE_LABEL, guestList, guestText, safeLink } from '@/services/meetingRequestService';
import MeetingActions from './MeetingActions.jsx';

/** Meeting details are visible to everyone: Venue, Facilitator, Participants, Guests, purpose and stage. */
export default function MeetingDetail({ entry }) {
  const person = entry.employee ?? {};
  const d = entry.details ?? {};
  const participants = d.participants ?? [];
  const guests = guestList(d.guests, d.guest_emails);
  return (
    <SlideOverBody>
      <DetailSection title="Requested by">
        <PersonChip person={{ id: person.id, name: person.name, dept: person.department, avatarPath: person.avatar }} />
      </DetailSection>
      <DetailSection title="Meeting">
        <dl>
          <DetailRow label="Purpose">{d.purpose}</DetailRow>
          {d.meeting_type && <DetailRow label="Type">{MEETING_TYPE_LABEL[d.meeting_type] ?? d.meeting_type}</DetailRow>}
          {(d.venue ?? entry.venue) && <DetailRow label="Venue">{d.venue ?? entry.venue}</DetailRow>}
          {d.meeting_link && (
            <DetailRow label="Meeting link">
              {safeLink(d.meeting_link) ? (
                <ExternalLink href={safeLink(d.meeting_link)} className="break-all underline">
                  {d.meeting_link}
                </ExternalLink>
              ) : (
                d.meeting_link
              )}
            </DetailRow>
          )}
          <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
          <DetailRow label="Time">{formatEntryTime(entry)}</DetailRow>
          <DetailRow label="Stage">{MEETING_STATUS_LABEL[d.stage] ?? d.stage}</DetailRow>
          <DetailRow label="Facilitator">{d.facilitator?.name}</DetailRow>
          <DetailRow label="Participants">{participants.length ? participants.map((p) => p.name).join(', ') : 'None'}</DetailRow>
          <DetailRow label="Guests">{guests.length ? guests.map(guestText).join(', ') : 'None'}</DetailRow>
        </dl>
      </DetailSection>
      <MeetingActions request={{ id: entry.id, status: d.stage, startsAt: entry.starts_at, applicantId: person.id }} />
    </SlideOverBody>
  );
}
