/**
 * Canvass and Offers (#275). Plain values the service, the screen and the print share.
 * There is no business-edited currency list yet, so the options are a short fixed list with a
 * database check of three capital letters behind it (`sor_canvass_offers_currency_chk`).
 */

export const DEFAULT_CURRENCY = "PHP";

/** The currencies the Offer form offers: the ones the IPAS sheet shows. */
export const CANVASS_CURRENCIES = ["PHP", "USD", "EUR", "AUD"];

/** Policy: compare at least this many suppliers before choosing one. */
export const MIN_CANVASS_OFFERS = 3;

/** CNV_ and four digits, assigned by the database when a Canvass is opened. */
export const CANVASS_NUMBER_PATTERN = /^CNV_\d{4,}$/;

/** An Offer's money keys, present only for a reader who may see money. */
export const OFFER_MONEY_KEYS = ["unit_price", "comparison_rate"];

/** The notification the purchasing approver list gets when a Canvass is ready to sign (#279). */
export const CANVASS_NOTIFICATION = {
  READY_TO_SIGN: "CANVASS_READY_TO_SIGN",
};

/** What a sign-off history row records. */
export const CANVASS_SIGNOFF_KIND = {
  SIGNED: "signed",
  CLEARED: "cleared",
};
