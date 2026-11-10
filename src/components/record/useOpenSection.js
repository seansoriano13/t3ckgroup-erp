import { useRecordParam } from "@/hooks/useRecordParam";

/**
 * The section the drawer shows, kept in `?open=<key>` so a link or a reload
 * lands on it. Opening pushes a history entry (Back closes the drawer); stepping
 * to a neighbour and closing replace it. A short section (`inPlace`) takes the
 * same param but expands under its row instead: `inPlace` names it.
 *
 * `drawerSections` are the sections the drawer steps through, in order;
 * `inPlaceKeys` the keys that expand under their row.
 */
export function useOpenSection({ drawerSections, inPlaceKeys = [] }) {
  const { recordId, open, step, close } = useRecordParam("open");
  const index = drawerSections.findIndex((section) => section.key === recordId);

  return {
    index,
    current: index >= 0 ? drawerSections[index] : null,
    inPlace: inPlaceKeys.includes(recordId) ? recordId : null,
    open: (key) => (key ? open(key) : close()),
    step,
    close,
  };
}
