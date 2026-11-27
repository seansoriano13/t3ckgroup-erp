import { format } from 'date-fns';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { formatEntryDate, formatEntryTime } from './entryFormat.js';
import { ExternalLink } from '@/components/ui/external-link';
import { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { ACTIVITY_TYPE_LABEL, MEETING_STATUS_LABEL, MEETING_TYPE_LABEL, guestList, guestText, safeLink } from '@/services/meetingRequestService';
import MeetingActions from './MeetingActions.jsx';
import GroupTaskLink from './GroupTaskLink.jsx';

const dayText = (ymd) => format(parseManilaDate(ymd), 'EEE, MMM d, yyyy');

/** Meeting details are visible to everyone: Venue, Lead, Participants, Guests, purpose and stage. */
export default function MeetingDetail({ entry }) {
  const person = entry.employee ?? {};
  const d = entry.details ?? {};
  const participants = d.participants ?? [];
  const range = entry.span?.days > 1 ? entry.span : null;
  const guests = guestList(d.guests, d.guest_emails);
  return (
    <SlideOverBody>
      <DetailSection title="Requested by">
        <PersonChip person={{ id: person.id, name: person.name, dept: person.department, avatarPath: person.avatar }} />
      </DetailSection>
      <DetailSection title="Activity">
        <dl>
          {d.activity_type && <DetailRow label="Activity type">{ACTIVITY_TYPE_LABEL[d.activity_type] ?? d.activity_type}</DetailRow>}
          <DetailRow label="Purpose"><span className="break-words">{d.purpose}</span></DetailRow>
          {d.meeting_type && <DetailRow label="Meeting type">{MEETING_TYPE_LABEL[d.meeting_type] ?? d.meeting_type}</DetailRow>}
          {(d.venue ?? entry.venue) && <DetailRow label="Venue">{d.venue ?? entry.venue}</DetailRow>}
          {d.meeting_link && (
            <DetailRow label="Meeting link">
              {safeLink(d.meeting_link) ? (
                <ExternalLink href={safeLink(d.meeting_link)} className="break-all underline">
                  {d.meeting_link}
                </ExternalLink>
              ) : (
                <span className="break-words">{d.meeting_link}</span>
              )}
            </DetailRow>
          )}
          {range ? (
            <>
              <DetailRow label="From">{dayText(range.first)}</DetailRow>
              <DetailRow label="To">{dayText(range.last)}</DetailRow>
            </>
          ) : (
            <>
              <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
              {d.days_total > 1 && <DetailRow label="Day">{`Day ${d.day_index} of ${d.days_total}`}</DetailRow>}
            </>
          )}
          {!range && <DetailRow label="Time">{formatEntryTime(entry)}</DetailRow>}
          {range && (
            <DetailRow label="Days">
              <ul className="space-y-1" data-testid="activity-days">
                {range.items.map((item) => (
                  <li key={item.id} data-clicked={item.id === entry.id} className={item.id === entry.id ? 'font-semibold' : undefined}>
                    {format(parseManilaDate(item.date), 'EEE, MMM d')}: {formatEntryTime(item)}
                    {item.id === entry.id && <span className="ml-1.5 rounded-full bg-mauve-12 px-2 py-0.5 text-xs font-bold text-mauve-1">Opened</span>}
                  </li>
                ))}
              </ul>
            </DetailRow>
          )}
          <DetailRow label="Status">{MEETING_STATUS_LABEL[d.stage] ?? d.stage}</DetailRow>
          <DetailRow label="Lead">{d.facilitator?.name}</DetailRow>
          <DetailRow label="Participants">{participants.length ? participants.map((p) => p.name).join(', ') : 'None'}</DetailRow>
          <DetailRow label="Guests"><span className="break-words">{guests.length ? guests.map(guestText).join(', ') : 'None'}</span></DetailRow>
        </dl>
      </DetailSection>
      {d.group_task_id && <GroupTaskLink groupTaskId={d.group_task_id} />}
      <MeetingActions request={{ id: d.request_id ?? entry.group_id ?? entry.id, status: d.stage, startsAt: d.last_day_starts_at ?? entry.starts_at, applicantId: person.id, hasVenue: Boolean(d.venue ?? entry.venue) }} />
    </SlideOverBody>
  );
}
