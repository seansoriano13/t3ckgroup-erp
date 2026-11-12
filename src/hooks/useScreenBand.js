import { useMediaQuery } from "./useMediaQuery";

/**
 * The one place the screen bands (spec #975, ADR 0051) are written for JS.
 * src/index.css repeats the laptop query for `@custom-variant laptop` and the
 * root font-size rule, because CSS cannot import a JS constant. Keep the
 * three in step.
 */
export const PHONE_QUERY = "(max-width: 767.98px)";
export const LAPTOP_QUERY =
  "(min-width: 1024px) and (max-width: 1535.98px), (min-width: 1024px) and (max-height: 820px)";
export const ROOMY_QUERY = "(min-width: 1440px) and (min-height: 701px)";
/** Same as ROOMY_QUERY but for a custom inline width (SidePanel's inlineFrom). */
export const roomyQuery = (fromPx) => `(min-width: ${fromPx}px) and (min-height: 701px)`;
/** Short viewport only (any width). */
export const SHORT_QUERY = "(max-height: 820px)";

/** Under the laptop band's 1024px floor (tablets and phones). */
export const BELOW_LAPTOP_QUERY = "(max-width: 1023.98px)";
/** The sidebar defaults to its icon rail under 1280px. */
export const RAIL_QUERY = "(max-width: 1279.98px)";

/** Under 768px. */
export const useIsPhone = () => useMediaQuery(PHONE_QUERY);
/** 1024px and wider, and either under 1536px wide or at most 820px tall. */
export const useLaptopBand = () => useMediaQuery(LAPTOP_QUERY);
/** Wide and tall enough to show a side column inline. */
export const useRoomy = (fromPx) => useMediaQuery(fromPx ? roomyQuery(fromPx) : ROOMY_QUERY);
export const useShortScreen = () => useMediaQuery(SHORT_QUERY);
