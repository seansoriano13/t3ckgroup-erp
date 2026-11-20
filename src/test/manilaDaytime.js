import { afterAll, vi } from "vitest";

/**
 * Pins the clock to 10:00 Manila on today's Manila date, for tests that read "today" through the app.
 *
 * The Meeting Request / Activity dialog opens on the next slot that can still be filed (06:00 to 21:45,
 * meetingDraft.js), so after 21:45 Manila it opens on tomorrow and a test looking for today's date fails.
 * CI runs on UTC, which is late evening in Manila, so those tests failed by the clock, not by the code.
 *
 * Only Date is faked; timers stay real (waitFor, user-event) and the clock keeps moving from 10:00.
 * Call it at the top of the test file, before anything that reads the date.
 */
export function pinManilaDaytime() {
  const manilaDay = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date(`${manilaDay}T10:00:00+08:00`));
  afterAll(() => vi.useRealTimers());
}
