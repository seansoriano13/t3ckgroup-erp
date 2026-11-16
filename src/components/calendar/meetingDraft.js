/** "06:00" .. "21:45" in 15-minute steps. */
export const TIME_OPTIONS = Array.from({ length: 64 }, (_, i) => {
  const minutes = 6 * 60 + i * 15;
  const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { value: hhmm, label: hhmm };
});

/** A Manila wall-clock date and time as an ISO instant (Manila is a fixed UTC+8). */
export const manilaInstant = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+08:00`).toISOString();

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Why a draft cannot be filed yet, in plain words, or null. */
export function draftProblem({ activityType = 'MEETING', meetingType = 'ONSITE', meetingLink = '', venueId, date, start, end, facilitatorId, purpose, guests = [] }, now = new Date()) {
  const isMeeting = activityType === 'MEETING';
  if (isMeeting && meetingType !== 'ONLINE' && !venueId) return 'Choose a Venue.';
  if (isMeeting && meetingType !== 'ONSITE' && !String(meetingLink ?? '').trim()) return 'Paste the meeting link.';
  if (!date) return 'Choose a date.';
  if (!start || !end) return 'Choose a start and end time.';
  if (end <= start) return 'The Activity must end after it starts.';
  if (new Date(manilaInstant(date, start)) < now) return 'The Activity cannot start in the past.';
  if (!facilitatorId) return 'Choose a Lead.';
  if (!purpose.trim()) return 'Write the purpose of the Activity.';
  const badEmail = guests.find((g) => g.email && !EMAIL.test(g.email.trim()));
  if (badEmail) return `Check the email for ${badEmail.name}.`;
  return null;
}
