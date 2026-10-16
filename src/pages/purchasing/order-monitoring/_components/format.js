/** Small helpers both Order Monitoring views share. */

export const HEAD = "text-label font-bold uppercase tracking-wider";

export const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
