import { useEffect, useSyncExternalStore } from 'react';

/**
 * Calendar full screen. One flag says the page is in full screen: the app's side
 * menu, the page title and the day panel hide. Turning it on also asks the
 * browser for real full screen; Esc or the same button turns both off. The side
 * menu keeps its own (saved) collapsed setting, so it comes back as it was.
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

const browserFullScreen = () => typeof document !== 'undefined' && Boolean(document.fullscreenElement);

function exitBrowserFullScreen() {
  if (browserFullScreen()) document.exitFullscreen?.()?.catch?.(() => {});
}

/** Leave full screen (both the page's and the browser's). */
export function leaveCalendarFullScreen() {
  set(false);
  exitBrowserFullScreen();
}

/** Enter or leave full screen. The page's full screen still applies when the browser refuses its own. */
export function toggleCalendarFullScreen() {
  if (on) {
    leaveCalendarFullScreen();
    return;
  }
  set(true);
  try {
    document.documentElement.requestFullscreen?.()?.catch?.(() => {});
  } catch {
    // The browser said no; the page's full screen still works.
  }
}

/** Is the Calendar in full screen? Read by the app frame to hide the side menu. */
export function useCalendarFullScreenOn() {
  return useSyncExternalStore(subscribe, () => on, () => false);
}

/**
 * For the Calendar page: reads the flag, ends full screen on Esc or when the
 * browser leaves its own, and ends it when the page goes away.
 */
export function useCalendarFullScreen() {
  const value = useCalendarFullScreenOn();
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && on && !e.defaultPrevented) leaveCalendarFullScreen();
    };
    const onBrowserChange = () => {
      if (!browserFullScreen()) set(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onBrowserChange);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onBrowserChange);
      leaveCalendarFullScreen();
    };
  }, []);
  return value;
}
