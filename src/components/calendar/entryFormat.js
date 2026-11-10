import { format } from 'date-fns';
import { toManila } from '@/lib/manilaDate.js';

/** "Mon, Oct 26, 2026" in Manila time. */
export function formatEntryDate(entry) {
  return format(toManila(entry.starts_at), 'EEE, MMM d, yyyy');
}

/** "8:00 AM to 5:00 PM" in Manila time, or "All day". */
export function formatEntryTime(entry) {
  if (entry.all_day) return 'All day';
  return `${format(toManila(entry.starts_at), 'h:mm a')} to ${format(toManila(entry.ends_at), 'h:mm a')}`;
}
