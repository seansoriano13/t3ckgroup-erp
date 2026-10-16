// The one state palette for the IPAS record page: the chain, the section rows,
// the drawer header. Done is green, Now (the one thing that needs doing next)
// is amber, Waiting is grey. A state is a dot or a mark beside its word, never a
// tinted pill (StatusBadge is the only status pill), and never colour alone:
// every use also carries its word from STATE_WORD.

import { getStatusTheme, getStatusToneClasses } from "@/constants/status";

export const STATE = {
  DONE: "done",
  CURRENT: "current",
  WAITING: "waiting",
};

export const STATE_WORD = {
  [STATE.DONE]: "Done",
  [STATE.CURRENT]: "Now",
  [STATE.WAITING]: "Waiting",
};

/** Classes per state, from the repo's one status palette (constants/status.js): "done", "current" and "waiting" are registered there. */
export const STATE_CLASS = {
  [STATE.DONE]: getStatusToneClasses(getStatusTheme(STATE.DONE)),
  [STATE.CURRENT]: getStatusToneClasses(getStatusTheme(STATE.CURRENT)),
  [STATE.WAITING]: getStatusToneClasses(getStatusTheme(STATE.WAITING)),
};
