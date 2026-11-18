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
import { useMeetingRealtime } from '@/hooks/useMeetingRealtime';
import { useAuth } from '@/context/AuthContext';
import { calendarService } from '@/services/calendarService';
import { employeeService } from '@/services/employeeService';
import { formTypeOptions } from '@/utils/activityFiling';
import { ACTIVITY_TYPE, MEETING_TYPE, MEETING_TYPE_LABEL, guestList, meetingRequestService, needsLink, needsVenue, requestDays } from '@/services/meetingRequestService';
import { SELECTOR_TYPES } from '@/utils/resolvePeople';
import { isIsoDate } from '@/utils/dateUtils.js';
import { manilaToday, manilaTime } from '@/lib/manilaDate.js';
import { draftProblem, manilaInstant } from './meetingDraft.js';
import { useActivitySettings } from '@/hooks/useActivitySettings';
import { enabledMeetingTypes, timeOptions } from '@/utils/activitySettings';
import ActivityDayRows from './ActivityDayRows.jsx';
import { daysFromSaved, daysPayload, keptDays } from './activityDays.js';
import { clashMessage, findClash, rangeWarnings, venueMeetings } from './meetingPreview.js';

/**
 * The Activity form (#619, #1055). Mounted only while open, so it starts blank each time.
 * The database refuses a clash; this form only asks and shows what the service says.
 */
export default function MeetingRequestDialog({ open, onClose, initial, editing = null, resend = false }) {
  if (!open) return null;
  return <MeetingRequestForm onClose={onClose} initial={initial} editing={editing} resend={resend} />;
}

const NO_DATES = new Set();

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
  // The rules HR set in Settings > Activities: types, meeting types, hours, default times, longest range, Guests.
  const settings = useActivitySettings();
  const rules = settings.general;
  const times = useMemo(() => timeOptions(rules), [rules]);
  const meetingTypeKeys = enabledMeetingTypes(rules);

  // Once Send is pressed the new entry reaches this form's own preview (realtime refresh), and would show as a clash with itself. The preview stops refetching from then on.
  const [sending, setSending] = useState(false);
  const [activityType, setActivityType] = useState(editing?.activity_type ?? ACTIVITY_TYPE.MEETING);
  const [meetingType, setMeetingType] = useState(editing?.meeting_type ?? (meetingTypeKeys.includes(MEETING_TYPE.ONSITE) ? MEETING_TYPE.ONSITE : meetingTypeKeys[0] ?? MEETING_TYPE.ONSITE));
  const [meetingLink, setMeetingLink] = useState(editing?.meeting_link ?? '');
  const [venuePick, setVenueId] = useState(editing?.venue_id ?? initial.venueId ?? '');
  // A saved request's days: the range, each day's own times, and the days that have already started.
  const saved = useMemo(() => (editing ? daysFromSaved(requestDays(editing)) : null), [editing]);
  const [date, setDate] = useState(() => saved?.from ?? initial.date ?? manilaToday());
  const [dateTo, setDateTo] = useState(() => saved?.to ?? '');
  const [dayEdits, setDayEdits] = useState(() => saved?.edits ?? {});
  const [start, setStart] = useState(saved?.start ?? initial.start ?? rules.defaultStart);
  const [end, setEnd] = useState(saved?.end ?? initial.end ?? rules.defaultEnd);
  const frozenDates = saved?.frozen ?? NO_DATES;
  const [facilitatorPick, setFacilitatorId] = useState(editing?.facilitator_id ?? '');  // the Lead
  const [participants, setParticipants] = useState(() =>
    (editing?.participants ?? []).map((p) => ({ type: SELECTOR_TYPES.EMPLOYEE, id: p.employee_id })),
  );
  const [guests, setGuests] = useState(() => guestList(editing?.guests, editing?.guest_emails));
  const [guestDraft, setGuestDraft] = useState('');
  const [guestEmailDraft, setGuestEmailDraft] = useState('');
  const [purpose, setPurpose] = useState(editing?.purpose ?? '');

  const { data: venues = [] } = useQuery({ queryKey: ['calendar-venues'], queryFn: () => meetingRequestService.listVenues() });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeeService.getAllEmployees() });
  const people = useMemo(() => [...employees].sort((a, b) => a.name.localeCompare(b.name)), [employees]);
  // The form offers only what the viewer may file; the database refuses the rest (#1063).
  const typeOptions = formTypeOptions(user, editing?.activity_type, settings).map((t) => ({ value: t, label: settings.types[t].name }));
  const isMeeting = activityType === ACTIVITY_TYPE.MEETING;
  // Whether this type can run over several days is a setting, not a rule of the Meeting.
  const multiDay = Boolean(settings.types[activityType]?.multiDay);
  const meetingTypeOptions = Object.values(MEETING_TYPE)
    .filter((t) => meetingTypeKeys.includes(t) || t === editing?.meeting_type)
    .map((t) => ({ value: t, label: MEETING_TYPE_LABEL[t] }));

  const { data: lastPicks } = useQuery({
    queryKey: ['meeting-last-picks', user?.id],
    queryFn: () => meetingRequestService.lastPicks(user.id),
    enabled: Boolean(user?.id),
  });
  // Remembered picks fill in until the applicant chooses something else.
  const venueId = !isMeeting || !needsVenue(meetingType) ? '' : venuePick || (venues.some((v) => v.id === lastPicks?.venueId) ? lastPicks.venueId : '');
  // The Lead defaults to the person filing; anyone can be picked instead.
  const facilitatorId = facilitatorPick || user?.id || '';

  // A date box hands over '' while cleared and a too-long year as typed. Nothing below works
  // out a time from a date that is not real: that threw "Invalid time value" and took the page down.
  const dateOk = isIsoDate(date);
  // A type that is one day is one row. A type that can run over several days goes From to To, one row per day.
  const rangeEnd = multiDay && isIsoDate(dateTo) && dateTo > date ? dateTo : date;
  const days = !multiDay
    ? [{ date, start, end, frozen: false }]
    : keptDays(date, rangeEnd, dayEdits, start, end, frozenDates);
  // Every day of the range, so the soft warnings cover each day. A Meeting's range is its one day.
  const { data: rangeAll = [] } = useQuery({
    queryKey: ['meeting-requests', 'form-range', date, rangeEnd],
    queryFn: () => calendarService.fetchEntries({ from: date, to: rangeEnd }),
    enabled: dateOk && !sending,
  });
  // Editing: the request's own slot is not a clash with itself.
  const rangeEntries = useMemo(() => (editing ? rangeAll.filter((e) => (e.group_id ?? e.id) !== editing.id) : rangeAll), [rangeAll, editing]);
  const setDayEdit = (day, edit) => setDayEdits((prev) => ({ ...prev, [day]: edit }));
  const venueName = !isMeeting || !needsVenue(meetingType) ? undefined : venues.find((v) => v.id === venueId)?.name;
  const startsAt = dateOk ? manilaInstant(date, start) : null;
  const endsAt = dateOk ? manilaInstant(date, end) : null;
  const windowOk = dateOk && end > start;
  const clash = venueName && windowOk ? findClash(rangeEntries, venueName, startsAt, endsAt) : null;
  const participantIds = participants.filter((p) => p.type === SELECTOR_TYPES.EMPLOYEE).map((p) => p.id);
  const pickedIds = [facilitatorId, ...participantIds];
  // Days that have started cannot change, so only the days still ahead are checked. The day is
  // named whenever the form shows more than one, even if only one is left to check.
  const warnings = dateOk
    ? rangeWarnings(rangeEntries, {
        people: employees.filter((e) => pickedIds.includes(e.id)).map((e) => ({ id: e.id, name: e.name })),
        days: days.filter((d) => !d.frozen && d.end > d.start),
        nameDays: days.length > 1,
      })
    : [];

  const problem = clash ? clashMessage(clash) : draftProblem({ activityType, meetingType, meetingLink, venueId, date, start, end, days, facilitatorId, purpose, guests, multiDay, typeName: settings.types[activityType]?.name, maxDays: rules.maxDays });

  const addGuest = () => {
    const name = guestDraft.trim();
    if (name && !guests.some((g) => g.name === name)) setGuests([...guests, { name, email: guestEmailDraft.trim() }]);
    setGuestDraft('');
    setGuestEmailDraft('');
  };

  const mutation = useMutation({
    onMutate: () => setSending(true),
    mutationFn: async () => {
      if (editing) {
        const saved = await meetingRequestService.editRequest({
          requestId: editing.id,
          activityType,
          meetingType,
          meetingLink,
          venueId,
          startsAt,
          endsAt,
          days: daysPayload(days),
          facilitatorId,
          purpose,
          guests,
          participantIds,
          actor: user,
        });
        if (resend) await meetingRequestService.resend({ requestId: editing.id, actor: user });
        return saved;
      }
      return meetingRequestService.fileRequest({
        activityType,
        meetingType,
        meetingLink,
        venueId,
        startsAt,
        endsAt,
        days: daysPayload(days),
        facilitatorId,
        purpose,
        guests,
        participantIds,
        applicant: user,
      });
    },
    onSuccess: () => {
      toast.success(editing ? (resend ? 'Activity sent again.' : 'Activity updated.') : 'Activity filed.');
      queryClient.invalidateQueries({ queryKey: ['calendar-entries'] });
      queryClient.invalidateQueries({ queryKey: ['meeting-requests'] });
      onClose(true);
    },
    onError: (err) => {
      setSending(false);
      toast.error(err.message);
    },
  });

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={['Calendar', editing ? 'Edit Activity' : 'New Activity']}
      title={editing ? 'Edit Activity' : 'New Activity'}
      actions={
        <Button disabled={Boolean(problem) || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Sending…' : resend ? 'Send again' : editing ? 'Save changes' : 'Send request'}
        </Button>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldBox label="Activity type" className="mb-1.5 block" />
          <SelectField value={activityType} onChange={setActivityType} options={typeOptions} className="w-full" />
        </div>
        {isMeeting && (
          <div className="sm:col-span-2">
            <FieldBox label="Meeting type" className="mb-1.5 block" />
            <SelectField
              value={meetingType}
              onChange={setMeetingType}
              options={meetingTypeOptions}
              className="w-full"
            />
          </div>
        )}
        {isMeeting && needsVenue(meetingType) && (
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
        )}
        {isMeeting && needsLink(meetingType) && (
          <div className={needsVenue(meetingType) ? '' : 'sm:col-span-2'}>
            <FieldBox label="Meeting link" className="mb-1.5 block" />
            <Input
              type="url"
              value={meetingLink}
              onChange={(e) => setMeetingLink(e.target.value)}
              placeholder="Paste the link, e.g. https://meet.google.com/..."
              containerClassName="w-full"
            />
          </div>
        )}
        <div>
          <FieldBox label={multiDay ? 'From' : 'Date'} className="mb-1.5 block" />
          <Input
            type="date"
            value={date}
            min={manilaToday()}
            disabled={frozenDates.size > 0}
            onChange={(e) => setDate(e.target.value)}
            containerClassName="w-full"
            className="font-semibold"
          />
        </div>
        {multiDay && (
          <div>
            <FieldBox label="To" className="mb-1.5 block" />
            <Input
              type="date"
              value={rangeEnd}
              min={date || undefined}
              onChange={(e) => setDateTo(e.target.value)}
              containerClassName="w-full"
              className="font-semibold"
            />
          </div>
        )}
        {venueName && dateOk && <VenuePreview venueName={venueName} meetings={venueMeetings(rangeEntries, venueName)} />}
        <div className="grid grid-cols-2 gap-4 sm:col-span-2">
          <div className="min-w-0">
            <FieldBox label="Start" className="mb-1.5 block" />
            <SelectField value={start} onChange={setStart} options={times} className="w-full" />
          </div>
          <div className="min-w-0">
            <FieldBox label="End" className="mb-1.5 block" />
            <SelectField value={end} onChange={setEnd} options={times} className="w-full" />
          </div>
        </div>
        {multiDay && <ActivityDayRows from={date} to={rangeEnd} edits={dayEdits} onEdit={setDayEdit} start={start} end={end} frozen={frozenDates} timeOptions={times} />}
        <div className="sm:col-span-2">
          <FieldBox label="Lead" className="mb-1.5 block" />
          <SelectField
            value={facilitatorId || null}
            onChange={setFacilitatorId}
            options={people.map((h) => ({ value: h.id, label: h.name }))}
            placeholder="Select the Lead..."
            className="w-full"
          />
        </div>
        <div className="sm:col-span-2">
          <FieldBox label="Participants" className="mb-1.5 block" />
          <PeoplePicker value={participants} onChange={setParticipants} types={[SELECTOR_TYPES.EMPLOYEE]} placeholder="Add participants" />
        </div>
        {(rules.guestsAllowed || guests.length > 0) && (
        <div className="sm:col-span-2">
          <FieldBox label="Guests (outside the company)" className="mb-1.5 block" />
          {rules.guestsAllowed ? (
          <div className="flex items-end gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <Input
              value={guestDraft}
              onChange={(e) => setGuestDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addGuest();
                }
              }}
              placeholder="Name"
              containerClassName="w-full sm:flex-1"
            />
            <Input
              type="email"
              value={guestEmailDraft}
              onChange={(e) => setGuestEmailDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addGuest();
                }
              }}
              placeholder="Email (optional)"
              containerClassName="w-full sm:flex-1"
            />
            </div>
            <Button type="button" variant="outline" onClick={addGuest} disabled={!guestDraft.trim()}>
              Add
            </Button>
          </div>
          ) : (
            <p className="text-xs text-muted-foreground">Guests are not allowed now. You can remove the ones already listed.</p>
          )}
          {guests.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {guests.map((g) => (
                <li key={g.name} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs">
                  {g.email ? `${g.name} <${g.email}>` : g.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${g.name}`}
                    onClick={() => setGuests(guests.filter((x) => x.name !== g.name))}
                  >
                    <X size={12} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        )}
        <div className="sm:col-span-2">
          <FieldBox label="Purpose" className="mb-1.5 block" />
          <Textarea value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={3} placeholder="What is the Activity for?" />
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs" data-testid="soft-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
          <li className="text-muted-foreground">You can still send it.</li>
        </ul>
      )}
      {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
    </ModalShell>
  );
}
