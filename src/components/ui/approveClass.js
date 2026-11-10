/**
 * Approve reads as "yes" in green, as it always has on the approval screens; red stays with Return.
 * Text is green-1 (the scale's own page colour), so the pair holds in both themes with no dark: override.
 * Light: green-1 on green-11 (#218358) is 4.65:1; hover green-12 (#193b2d) is 12.1:1.
 * Dark: green-1 (#0e1512) on green-11 (#3dd68c) is 9.9:1; hover green-12 (#b1f1cb) is 14.4:1.
 */
export const APPROVE_CLASS = "bg-green-11 text-green-1 shadow-sm hover:bg-green-12";
