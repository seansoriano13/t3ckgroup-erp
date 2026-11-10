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

/** CNV_ and four digits, assigned by the database when a Canvass's first Offer is saved (ADR 0034). */
export const CANVASS_NUMBER_PATTERN = /^CNV_\d{4,}$/;

/**
 * A Canvass is locked once a Purchase Request was made from it (`canvass_is_locked`). The database
 * owns the rule and enforces it; a Super Admin can release the lock.
 */
export const CANVASS_LOCKED_MESSAGE =
  "Locked: a Purchase Request was made from this Canvass, so its offers, winner and reason can't change.";

/** An Offer's money keys, present only for a reader who may see money. */
export const OFFER_MONEY_KEYS = ["unit_price", "comparison_rate"];

/** What a Canvass is on (ADR 0034): a Costing Matrix Component, a Requested Item, or nothing yet. */
export const CANVASS_KIND = {
  COMPONENT: "component",
  REQUESTED_ITEM: "requested_item",
  NONE: "none",
};

/** The Canvasses page's list query; every Canvass write invalidates it. */
export const CANVASS_LIST_KEY = ["canvasses"];

