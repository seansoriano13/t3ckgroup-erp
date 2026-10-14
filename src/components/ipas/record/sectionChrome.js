// How a section body is drawn. Three places draw the same bodies:
//   CARD    the stacked card on the edit view (framed, with its title, every
//           control live, the sign-off buttons in it)
//   DRAWER  the drawer: its header already names the section, so no frame and
//           no title; the pinned footer holds the sign-off moves, so the body's
//           own sign-off buttons are hidden; the money is read-only, so edit
//           controls and ticks show as read-only text (#533). Read-only
//           content (who signed, when) stays in every chrome.
//   INLINE  a short section expanded in place under its row: no frame and no
//           title (the row names it), and its controls stay live (#533).

import { createContext, useContext } from "react";

export const CHROME = { CARD: "card", DRAWER: "drawer", INLINE: "inline" };

export const IpasSectionChrome = createContext(CHROME.CARD);

export function useChrome() {
  return useContext(IpasSectionChrome);
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
