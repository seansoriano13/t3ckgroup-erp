// How a section body is drawn. The drawer sets "drawer": its header already
// names the section (number, title, state), so the card frame and title are
// not drawn twice, and the drawer's pinned footer holds the sign-off moves, so
// the body's own sign-off buttons are hidden. Edit controls follow the same
// signal (#533). Read-only content (who signed, when) stays in every chrome.

import { createContext, useContext } from "react";

export const CHROME = { CARD: "card", DRAWER: "drawer" };

export const IpasSectionChrome = createContext(CHROME.CARD);

/** True when a section body is rendered inside the drawer. */
export function useInDrawer() {
  return useContext(IpasSectionChrome) === CHROME.DRAWER;
}
