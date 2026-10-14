// The one state palette for the IPAS record page: the chain, the section rows,
// the drawer header. Done is green, Now (the one thing that needs doing next)
// is amber, Waiting is grey. A state is never shown by colour alone: every use
// also carries its word from STATE_WORD.

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

/** Classes per state. Text uses step 12 (or the muted step 11) so it clears 4.5:1 on the card. */
export const STATE_CLASS = {
  [STATE.DONE]: {
    dot: "bg-green-9",
    text: "text-green-12",
    chip: "border-green-7 bg-green-3 text-green-12",
  },
  [STATE.CURRENT]: {
    dot: "bg-amber-9",
    text: "text-amber-12",
    chip: "border-amber-7 bg-amber-3 text-amber-12",
  },
  [STATE.WAITING]: {
    dot: "bg-mauve-7",
    text: "text-muted-foreground",
    chip: "border-mauve-6 bg-mauve-2 text-muted-foreground",
  },
};
