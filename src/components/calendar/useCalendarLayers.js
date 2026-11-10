import { useCallback, useState } from 'react';
import { DEFAULT_LAYERS } from './entryKinds.jsx';

const STORAGE_KEY = 'calendar.layers';

function read() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULT_LAYERS, ...saved };
  } catch {
    // Storage blocked or unreadable: the page works with the defaults.
  }
  return { ...DEFAULT_LAYERS };
}

/**
 * Layer toggles, remembered per viewer in this browser. Storage is a convenience only.
 * A `preset` (a filtered view of the Calendar, such as HR's) starts from those
 * layers and neither reads nor writes the remembered choice.
 */
export function useCalendarLayers(preset = null) {
  const [layers, setLayers] = useState(() => (preset ? { ...DEFAULT_LAYERS, ...preset } : read()));

  const toggle = useCallback(
    (key) => {
      setLayers((current) => {
        const next = { ...current, [key]: !current[key] };
        if (preset) return next;
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Not remembered, still toggled.
        }
        return next;
      });
    },
    [preset],
  );

  return [layers, toggle];
}
