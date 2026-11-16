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
export function draftProblem({ activityType = 'MEETING', meetingType = 'ONSITE', meetingLink = '', venueId, date, start, end, days, facilitatorId, purpose, guests = [] }, now = new Date()) {
  const isMeeting = activityType === 'MEETING';
  if (isMeeting && meetingType !== 'ONLINE' && !venueId) return 'Choose a Venue.';
  if (isMeeting && meetingType !== 'ONSITE' && !String(meetingLink ?? '').trim()) return 'Paste the meeting link.';
  if (!date) return 'Choose a date.';
  if (!start || !end) return 'Choose a start and end time.';
  if (days) {
    // A range: every kept day is checked. A day that has already started is not checked again.
    if (days.length === 0) return 'Keep at least one day.';
    if (days.length > 1 && isMeeting) return 'A Meeting is one day.';
    const backwards = days.find((d) => d.end <= d.start);
    if (backwards) return `${backwards.date}: the Activity must end after it starts.`;
    const past = days.find((d) => !d.frozen && new Date(manilaInstant(d.date, d.start)) < now);
    if (past) return `${past.date}: the Activity cannot start in the past.`;
  } else {
    if (end <= start) return 'The Activity must end after it starts.';
    if (new Date(manilaInstant(date, start)) < now) return 'The Activity cannot start in the past.';
  }
  if (!facilitatorId) return 'Choose a Lead.';
  if (!purpose.trim()) return 'Write the purpose of the Activity.';
  const badEmail = guests.find((g) => g.email && !EMAIL.test(g.email.trim()));
  if (badEmail) return `Check the email for ${badEmail.name}.`;
  return null;
}
