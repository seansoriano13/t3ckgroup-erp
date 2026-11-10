// How a section body is drawn. Three places draw the same bodies:
//   CARD    the stacked card on the edit view (framed, with its title, every
//           control live, the sign-off buttons in it)
//   DRAWER  a section's read view (the Transmittal and Packing List drawer, and
//           the IPAS's money and sign-off sections opened in place): its header
//           already names the section, so no frame and no title; the foot
//           holds the sign-off moves, so the body's own sign-off buttons are
//           hidden; the money is read-only, so edit controls and ticks show as
//           read-only text (#533). Read-only content (who signed, when) stays
//           in every chrome. A section expanded in place that edits in the
//           edit view (the IPAS's Header and Sales) uses this read-only chrome
//           under its row too.
//   INLINE  a short section expanded in place under its row: no frame and no
//           title (the row names it), and its controls stay live (#533).

import { createContext, useContext } from "react";

export const CHROME = { CARD: "card", DRAWER: "drawer", INLINE: "inline" };

/** Where a move is drawn: the decision card, or a section's own foot. A failure shows only at its origin. */
export const MOVE_ORIGIN = { CARD: "card", SECTION: "section" };

export const RecordSectionChrome = createContext(CHROME.CARD);

export function useChrome() {
  return useContext(RecordSectionChrome);
}

/** True when a section body is rendered inside the drawer. */
export function useInDrawer() {
  return useChrome() === CHROME.DRAWER;
}

/** True when the row or the drawer header names the section, so the body draws no frame or title. */
export function useBare() {
  return useChrome() !== CHROME.CARD;
}

/**
 * An edit control shows when the viewer is granted it, and never in the
 * read-only drawer. Sections call it once on the grant they were passed.
 */
export function useEditable(granted) {
  const inDrawer = useInDrawer();
  return Boolean(granted) && !inDrawer;
}
