import { format } from 'date-fns';
import { parseManilaDate } from '@/lib/manilaDate.js';
import { formatEntryDate, formatEntryTime } from './entryFormat.js';
import SlideOver, { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { Button } from '@/components/ui/button';
import { kindOf } from './entryKinds.jsx';
import { canWithdrawEntry } from './withdraw.js';

const STATUS_LABEL = { APPROVED: 'Approved', PENDING: 'Pending' };

const spanDates = (span) =>
  `${format(parseManilaDate(span.first), 'EEE, MMM d')} to ${format(parseManilaDate(span.last), 'EEE, MMM d, yyyy')}`;

/**
 * The shared body: who, when, status, hours, venue, and the reason only when
 * the server sent one. A multi-day request (`entry.span`, from withSpan) shows
 * its whole range, day count and total hours, not just the day clicked.
 */
export function DefaultEntryDetail({ entry }) {
  const person = entry.employee ?? {};
  const reason = entry.details?.reason;
  const many = entry.span?.days > 1;
  return (
    <SlideOverBody>
      <DetailSection title="Who">
        <PersonChip person={{ id: person.id, name: person.name, dept: person.department, avatarPath: person.avatar }} />
      </DetailSection>
      <DetailSection title="Details">
        <dl>
          {many ? (
            <>
              <DetailRow label="Dates">{spanDates(entry.span)}</DetailRow>
              <DetailRow label="Days">{entry.span.days}</DetailRow>
            </>
          ) : (
            <DetailRow label="Date">{formatEntryDate(entry)}</DetailRow>
          )}
          <DetailRow label="Time">{formatEntryTime(entry)}</DetailRow>
          <DetailRow label="Status">{STATUS_LABEL[entry.status] ?? entry.status}</DetailRow>
          {many ? (
            <DetailRow label="Total hours">{entry.span.hours}</DetailRow>
          ) : (
            entry.hours != null && <DetailRow label="Hours">{Number(entry.hours)}</DetailRow>
          )}
          {entry.venue && <DetailRow label="Venue">{entry.venue}</DetailRow>}
          {reason && <DetailRow label="Reason">{reason}</DetailRow>}
        </dl>
      </DetailSection>
    </SlideOverBody>
  );
}

/** The detail panel for one Calendar entry; each kind may supply its own body in the registry. */
export default function EntryDetail({ entry, onClose, entries = [], viewerId = null, onWithdraw = null }) {
  return (
    <SlideOver
      record={entry}
      icon={entry ? kindOf(entry.kind)?.icon : undefined}
      crumb="Calendar"
      identity={(e) => ({
        ref: kindOf(e.kind)?.label ?? e.kind,
        title: e.span?.days > 1 ? `${kindOf(e.kind)?.label} · ${e.span.days} days` : e.title || kindOf(e.kind)?.label || e.kind,
        subtitle: e.employee?.name,
      })}
      onClose={onClose}
    >
      {(e) => {
        const Body = kindOf(e.kind)?.Detail ?? DefaultEntryDetail;
        return (
          <>
            <Body entry={e} />
            {onWithdraw && canWithdrawEntry(e, entries, viewerId) && (
              <div className="px-4 pb-4">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onWithdraw(e);
                    onClose();
                  }}
                >
                  Withdraw
                </Button>
              </div>
            )}
          </>
        );
      }}
    </SlideOver>
  );
}
