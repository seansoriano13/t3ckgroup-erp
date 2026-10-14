import { useRecordParam } from "@/hooks/useRecordParam";

import { DRAWER_SECTIONS, isInPlace } from "./digest";

/**
 * The section the drawer shows, kept in `?open=<key>` so a link or a reload
 * lands on it. Opening pushes a history entry (Back closes the drawer); stepping
 * to a neighbour and closing replace it. A short section (`inPlace`) takes the
 * same param but expands under its row instead: `inPlace` names it.
 */
export function useOpenSection() {
  const { recordId, open, step, close } = useRecordParam("open");
  const index = DRAWER_SECTIONS.findIndex((section) => section.key === recordId);

  return {
    index,
    current: index >= 0 ? DRAWER_SECTIONS[index] : null,
    inPlace: isInPlace(recordId) ? recordId : null,
    open: (key) => (key ? open(key) : close()),
    step: (key) => step(key),
    close,
  };
}
