import { formatPHP } from "../constants/sor";

/** What a blank cell reads as on the Retail screen. */
export const BLANK = "—";

/** "₱1,234.00", or "—" when there is no figure (null/undefined, never a zero). */
export const formatPHPOrDash = (amount) => (amount == null ? BLANK : formatPHP(amount));

/** "10/5/2026" (en-PH) for an order date, or "—" with none. */
export const formatDateOrDash = (value) => (value ? new Date(value).toLocaleDateString("en-PH") : BLANK);

/** "1,234" (en-PH) for an order count. */
export const formatCount = (count) => count.toLocaleString("en-PH");
