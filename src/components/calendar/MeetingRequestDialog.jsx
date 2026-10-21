import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import ModalShell from '@/components/ui/ModalShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FieldBox } from '@/components/ui/FieldBox';
import { SelectField } from '@/components/ui/SelectField';
import PeoplePicker from '@/components/ui/PeoplePicker';
import HeadSelectField from '@/components/offsets/HeadSelectField';
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { employeeService } from '@/services/employeeService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { SELECTOR_TYPES } from '@/utils/resolvePeople';
import { manilaDate, manilaToday, manilaTime } from '@/lib/manilaDate.js';
import { TIME_OPTIONS, draftProblem, manilaInstant } from './meetingDraft.js';
import { clashMessage, findClash, softWarnings, venueMeetings } from './meetingPreview.js';

/**
 * The Meeting Request form (#619). Mounted only while open, so it starts blank each time.
 * The database refuses a clash; this form only asks and shows what the service says.
 */
export default function MeetingRequestDialog({ open, onClose, initial, editing = null, resend = false }) {
  if (!open) return null;
  return <MeetingRequestForm onClose={onClose} initial={initial} editing={editing} resend={resend} />;
}

/** The chosen Venue's day: held slots listed, pending ones faded. */
function VenuePreview({ venueName, meetings }) {
  return (
    <div className="sm:col-span-2" data-testid="venue-preview">
      <FieldBox label={`${venueName} on this day`} className="mb-1.5 block" />
      {meetings.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing is held yet. The whole day is free.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {meetings.map((m) => {
            const pending = m.status !== 'APPROVED';
            return (
              <li
                key={m.id}
                className={`flex min-w-0 flex-wrap items-baseline gap-x-2 rounded border px-2 py-1 text-xs ${pending ? 'border-dashed opacity-60' : 'border-border bg-muted/40'}`}
              >
                <span className="font-semibold">
                  {manilaTime(m.starts_at)} to {manilaTime(m.ends_at)}
                </span>
                <span className="min-w-0 truncate">
                  {m.title} · {m.employee?.name}
                </span>
                <span className="text-muted-foreground">{pending ? 'Pending' : 'Approved'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** `editing` is a saved request (from getRequest) to change; `resend` also sends a returned one again. */
function MeetingRequestForm({ onClose, initial = {}, editing = null, resend = false }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useMeetingRealtime();

  const [venuePick, setVenueId] = useState(editing?.venue_id ?? initial.venueId ?? '');
  const [date, setDate] = useState(() => (editing ? manilaDate(editing.starts_at) : (initial.date ?? manilaToday())));
  const [start, setStart] = useState(editing ? manilaTime(editing.starts_at) : (initial.start ?? '09:00'));
  const [end, setEnd] = useState(editing ? manilaTime(editing.ends_at) : (initial.end ?? '10:00'));
  const [facilitatorPick, setFacilitatorId] = useState(editing?.facilitator_id ?? '');
  const [participants, setParticipants] = useState(() =>
    (editing?.participants ?? []).map((p) => ({ type: SELECTOR_TYPES.EMPLOYEE, id: p.employee_id })),
  );
  const [guests, setGuests] = useState(editing?.guests ?? []);
  const [guestDraft, setGuestDraft] = useState('');
  const [purpose, setPurpose] = useState(editing?.purpose ?? '');
  const [headId, setHeadId] = useState(editing?.head_id ?? '');

  const { data: venues = [] } = useQuery({ queryKey: ['calendar-venues'], queryFn: () => meetingRequestService.listVenues() });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeeService.getAllEmployees() });
  const heads = useMemo(() => employees.filter((e) => e.isHead).sort((a, b) => a.name.localeCompare(b.name)), [employees]);

  const { data: lastPicks } = useQuery({
    queryKey: ['meeting-last-picks', user?.id],
    queryFn: () => meetingRequestService.lastPicks(user.id),
    enabled: Boolean(user?.id),
  });
  // Remembered picks fill in until the applicant chooses something else.
  const venueId = venuePick || (venues.some((v) => v.id === lastPicks?.venueId) ? lastPicks.venueId : '');
  const facilitatorId = facilitatorPick || (heads.some((h) => h.id === lastPicks?.facilitatorId) ? lastPicks.facilitatorId : '');

  const { data: dayAll = [] } = useQuery({
    queryKey: ['meeting-requests', 'venue-day', date],
    queryFn: () => calendarService.fetchEntries({ from: date, to: date }),
    enabled: Boolean(date),
  });
  // Editing: the request's own slot is not a clash with itself.
  const dayEntries = useMemo(() => (editing ? dayAll.filter((e) => e.id !== editing.id) : dayAll), [dayAll, editing]);
  const venueName = venues.find((v) => v.id === venueId)?.name;
  const startsAt = manilaInstant(date, start);
  const endsAt = manilaInstant(date, end);
  const windowOk = Boolean(date) && end > start;
  const clash = venueName && windowOk ? findClash(dayEntries, venueName, startsAt, endsAt) : null;
  const pickedIds = [facilitatorId, ...participants.filter((p) => p.type === SELECTOR_TYPES.EMPLOYEE).map((p) => p.id)];
  const warnings =
    venueName && windowOk
      ? softWarnings(dayEntries, {
          people: employees.filter((e) => pickedIds.includes(e.id)).map((e) => ({ id: e.id, name: e.name })),
          venueName,
          startsAt,
          endsAt,
        })
      : [];

  const needsHead = !user?.is_head && !user?.isHead;
  const problem = clash ? clashMessage(clash) : draftProblem({ venueId, date, start, end, facilitatorId, purpose, headId, needsHead });

  const addGuest = () => {
    const name = guestDraft.trim();
    if (name && !guests.includes(name)) setGuests([...guests, name]);
    setGuestDraft('');
  };

  const mutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const saved = await meetingRequestService.editRequest({
          requestId: editing.id,
          venueId,
          startsAt,
          endsAt,
          facilitatorId,
          purpose,
          guests,
          participantIds: participants.filter((p) => p.type === SELECTOR_TYPES.EMPLOYEE).map((p) => p.id),
          headId: needsHead ? headId : null,
          actor: user,
        });
        if (resend) await meetingRequestService.resend({ requestId: editing.id, actor: user });
        return saved;
      }
      return meetingRequestService.fileRequest({
        venueId,
        startsAt,
        endsAt,
        facilitatorId,
        purpose,
        guests,
        participantIds: participants.filter((p) => p.type === SELECTOR_TYPES.EMPLOYEE).map((p) => p.id),
        headId: needsHead ? headId : null,
        applicant: user,
      });
    },
    onSuccess: () => {
      toast.success(editing ? (resend ? 'Meeting Request sent again.' : 'Meeting Request updated.') : 'Meeting Request filed.');
      queryClient.invalidateQueries({ queryKey: ['calendar-entries'] });
      queryClient.invalidateQueries({ queryKey: ['meeting-requests'] });
      onClose(true);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={['Calendar', editing ? 'Edit Meeting Request' : 'New Meeting Request']}
      title={editing ? 'Edit Meeting Request' : 'New Meeting Request'}
      actions={
        <Button size="lg" disabled={Boolean(problem) || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Sending…' : resend ? 'Send again' : editing ? 'Save changes' : 'Send request'}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <FieldBox label="Venue" className="mb-1.5 block" />
          <SelectField
            value={venueId || null}
            onChange={setVenueId}
            options={venues.map((v) => ({ value: v.id, label: v.name }))}
            placeholder="Select Venue..."
            className="w-full"
          />
        </div>
        <div>
          <FieldBox label="Date" className="mb-1.5 block" />
          <Input type="date" value={date} min={manilaToday()} onChange={(e) => setDate(e.target.value)} containerClassName="w-full" className="font-semibold" />
        </div>
        {venueName && date && <VenuePreview venueName={venueName} meetings={venueMeetings(dayEntries, venueName)} />}
        <div>
          <FieldBox label="Start"className="mb-1.5 block" />
          <SelectField value={start} onChange={setStart} options={TIME_OPTIONS} className="w-full" />
        </div>
        <div>
          <FieldBox label="End" className="mb-1.5 block" />
          <SelectField value={end} onChange={setEnd} options={TIME_OPTIONS} className="w-full" />
        </div>
        <div className="sm:col-span-2">
          <FieldBox label="Facilitator" className="mb-1.5 block" />
          <SelectField
            value={facilitatorId || null}
            onChange={setFacilitatorId}
            options={heads.map((h) => ({ value: h.id, label: h.name }))}
            placeholder="Select a department head..."
            className="w-full"
          />
        </div>
        <div className="sm:col-span-2">
          <FieldBox label="Participants" className="mb-1.5 block" />
          <PeoplePicker value={participants} onChange={setParticipants} types={[SELECTOR_TYPES.EMPLOYEE]} placeholder="Add participants" />
        </div>
        <div className="sm:col-span-2">
          <FieldBox label="Guests (outside the company)" className="mb-1.5 block" />
          <div className="flex gap-2">
            <Input
              value={guestDraft}
              onChange={(e) => setGuestDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addGuest();
                }
              }}
              placeholder="Type a name"
              containerClassName="flex-1"
            />
            <Button type="button" variant="outline" onClick={addGuest} disabled={!guestDraft.trim()}>
              Add
            </Button>
          </div>
          {guests.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {guests.map((g) => (
                <li key={g} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                  {g}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${g}`}
                    onClick={() => setGuests(guests.filter((x) => x !== g))}
                  >
                    <X size={12} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="sm:col-span-2">
          <FieldBox label="Purpose" className="mb-1.5 block" />
          <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} placeholder="What is the meeting for?" />
        </div>
        {needsHead && (
          <div className="sm:col-span-2">
            <HeadSelectField employee={user} value={headId} onChange={setHeadId} />
          </div>
        )}
      </div>
      {warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs" data-testid="soft-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
          <li className="text-muted-foreground">You can still send the request.</li>
        </ul>
      )}
      {problem && date && <p className="text-xs text-muted-foreground">{problem}</p>}
    </ModalShell>
  );
}
