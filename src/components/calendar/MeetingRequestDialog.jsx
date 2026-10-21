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
import { employeeService } from '@/services/employeeService';
import { meetingRequestService } from '@/services/meetingRequestService';
import { SELECTOR_TYPES } from '@/utils/resolvePeople';
import { manilaToday } from '@/lib/manilaDate.js';
import { TIME_OPTIONS, draftProblem, manilaInstant } from './meetingDraft.js';

/**
 * The Meeting Request form (#619). Mounted only while open, so it starts blank each time.
 * The database refuses a clash; this form only asks and shows what the service says.
 */
export default function MeetingRequestDialog({ open, onClose }) {
  if (!open) return null;
  return <MeetingRequestForm onClose={onClose} />;
}

function MeetingRequestForm({ onClose }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  useMeetingRealtime();

  const [venueId, setVenueId] = useState('');
  const [date, setDate] = useState(() => manilaToday());
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [facilitatorId, setFacilitatorId] = useState('');
  const [participants, setParticipants] = useState([]);
  const [guests, setGuests] = useState([]);
  const [guestDraft, setGuestDraft] = useState('');
  const [purpose, setPurpose] = useState('');
  const [headId, setHeadId] = useState('');

  const { data: venues = [] } = useQuery({ queryKey: ['calendar-venues'], queryFn: () => meetingRequestService.listVenues() });
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: () => employeeService.getAllEmployees() });
  const heads = useMemo(() => employees.filter((e) => e.isHead).sort((a, b) => a.name.localeCompare(b.name)), [employees]);

  const needsHead = !user?.is_head && !user?.isHead;
  const problem = draftProblem({ venueId, date, start, end, facilitatorId, purpose, headId, needsHead });

  const addGuest = () => {
    const name = guestDraft.trim();
    if (name && !guests.includes(name)) setGuests([...guests, name]);
    setGuestDraft('');
  };

  const mutation = useMutation({
    mutationFn: () =>
      meetingRequestService.fileRequest({
        venueId,
        startsAt: manilaInstant(date, start),
        endsAt: manilaInstant(date, end),
        facilitatorId,
        purpose,
        guests,
        participantIds: participants.filter((p) => p.type === SELECTOR_TYPES.EMPLOYEE).map((p) => p.id),
        headId: needsHead ? headId : null,
        applicant: user,
      }),
    onSuccess: () => {
      toast.success('Meeting Request filed.');
      queryClient.invalidateQueries({ queryKey: ['calendar-entries'] });
      queryClient.invalidateQueries({ queryKey: ['meeting-requests'] });
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      crumbs={['Calendar', 'New Meeting Request']}
      title="New Meeting Request"
      actions={
        <Button size="lg" disabled={Boolean(problem) || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Sending…' : 'Send request'}
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
        <div>
          <FieldBox label="Start" className="mb-1.5 block" />
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
      {problem && date && <p className="text-xs text-muted-foreground">{problem}</p>}
    </ModalShell>
  );
}
