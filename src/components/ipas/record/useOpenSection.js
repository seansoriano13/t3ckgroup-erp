import { useRecordParam } from "@/hooks/useRecordParam";

import { SECTIONS } from "./digest";

/**
 * The section the drawer shows, kept in `?open=<key>` so a link or a reload
 * lands on it. Opening pushes a history entry (Back closes the drawer); stepping
 * to a neighbour and closing replace it.
 */
export function useOpenSection() {
  const { recordId, open, step, close } = useRecordParam("open");
  const index = SECTIONS.findIndex((section) => section.key === recordId);

  return {
    index,
    current: index >= 0 ? SECTIONS[index] : null,
    open: (key) => (key ? open(key) : close()),
    step: (key) => step(key),
    close,
  };
}
