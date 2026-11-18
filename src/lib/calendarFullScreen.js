import { useEffect, useSyncExternalStore } from 'react';

/**
 * Calendar full screen. One flag says the page is in full screen: the app's side
 * menu, the page title and the day panel hide, and the Calendar fills the
 * window. It never asks the browser for real full screen. Esc or the same button
 * turns it off. The side menu keeps its own (saved) collapsed setting, so it
 * comes back as it was.
 */
let on = false;
const listeners = new Set();

function set(next) {
  if (on === next) return;
  on = next;
  listeners.forEach((l) => l());
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Leave full screen. */
export function leaveCalendarFullScreen() {
  set(false);
}

/** Enter or leave full screen. */
export function toggleCalendarFullScreen() {
  set(!on);
}

/** Is the Calendar in full screen? Read by the app frame to hide the side menu. */
export function useCalendarFullScreenOn() {
  return useSyncExternalStore(subscribe, () => on, () => false);
}

/**
 * For the Calendar page: reads the flag, ends full screen on Esc, and ends it
 * when the page goes away.
 */
export function useCalendarFullScreen() {
  const value = useCalendarFullScreenOn();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && on && !e.defaultPrevented) leaveCalendarFullScreen();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      leaveCalendarFullScreen();
    };
  }, []);
  return value;
}
