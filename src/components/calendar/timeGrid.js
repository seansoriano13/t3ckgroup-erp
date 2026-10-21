import { manilaDate, toManila } from '@/lib/manilaDate.js';

export const DAY_MINUTES = 24 * 60;

/** Minutes since Manila midnight for an instant. */
function minutesOfDay(instant) {
  const t = toManila(instant);
  return t.getHours() * 60 + t.getMinutes();
}

/** Whether an entry belongs in the all-day row (no time window). */
export function isAllDay(entry) {
  return Boolean(entry.all_day) || !entry.starts_at || !entry.ends_at;
}

/**
 * Give overlapping blocks side-by-side lanes. Blocks in the same cluster (a chain of
 * overlaps) share one lane count, so they split the width evenly.
 */
export function assignLanes(blocks) {
  const sorted = [...blocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out = [];
  let cluster = [];
  let clusterEnd = -1;
  let laneEnds = [];
  const flush = () => {
    for (const b of cluster) b.lanes = laneEnds.length;
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
  };
  for (const block of sorted) {
    if (cluster.length && block.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= block.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.endMin;
    clusterEnd = Math.max(clusterEnd, block.endMin);
    cluster.push({ ...block, lane });
  }
  flush();
  return out;
}

/**
 * Split one Manila day's entries into the all-day row and positioned timed blocks.
 * Times are read in Manila, so a 6 AM Manila entry (the previous day in UTC) lands on
 * the right day at 06:00. A timed entry crossing midnight is clipped to this day.
 */
export function placeDay(entries, ymd) {
  const allDay = [];
  const timed = [];
  for (const entry of entries) {
    if (isAllDay(entry)) {
      if (entry.manila_date === ymd) allDay.push(entry);
      continue;
    }
    const startYmd = manilaDate(entry.starts_at);
    const endYmd = manilaDate(entry.ends_at);
    if (ymd < startYmd || ymd > endYmd) continue;
    const startMin = startYmd === ymd ? minutesOfDay(entry.starts_at) : 0;
    let endMin = endYmd === ymd ? minutesOfDay(entry.ends_at) : DAY_MINUTES;
    if (endMin <= startMin) endMin = Math.min(startMin + 15, DAY_MINUTES);
    timed.push({ entry, startMin, endMin });
  }
  return { allDay, timed: assignLanes(timed) };
}
