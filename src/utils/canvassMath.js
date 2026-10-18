/**
 * The Canvass's figures (#275, built in #276). Pure: no network, no React. The service, the
 * screen and (later) the print read their numbers from here, so a Canvass says one thing
 * everywhere.
 *
 * Money is exact (costingMath carries it as BigInt centavos) and is rounded to the centavo, half
 * away from zero, only when a figure is returned. Blank is never zero: an Offer with no price, or
 * a foreign Offer with no rate, has no PHP figure (null). A price the viewer's tier never received
 * is blank too, because the service leaves the key off and a missing key reads like a null.
 */

import { DEFAULT_CURRENCY, MIN_CANVASS_OFFERS } from "../constants/canvass";
import { extended } from "./costingMath";

const isBlank = (value) => value === null || value === undefined || value === "";

/** An Offer's currency, PHP when none is recorded. */
export const offerCurrency = (offer) => String(offer?.currency || DEFAULT_CURRENCY).toUpperCase();

/**
 * The Offer's unit price in PHP: the price itself when quoted in PHP, price x comparison rate
 * when foreign and a rate is recorded, null otherwise.
 */
export function phpFigure(offer) {
  if (!offer || isBlank(offer.unit_price)) return null;
  if (offerCurrency(offer) === DEFAULT_CURRENCY) return extended(offer.unit_price, 1);
  if (isBlank(offer.comparison_rate)) return null;
  return extended(offer.unit_price, offer.comparison_rate);
}

/** Fewer than the policy minimum of three Offers. */
export const needsMoreOffers = (offers = []) =>
  (Array.isArray(offers) ? offers : []).length < MIN_CANVASS_OFFERS;

const COUNT_WORD = ["No", "One", "Two"];

/** "Two offers only — below the three-offer minimum", or null when there are enough. */
export function moreOffersWarning(offers = []) {
  if (!needsMoreOffers(offers)) return null;
  const count = (Array.isArray(offers) ? offers : []).length;
  const lead = count === 0 ? "No offers yet" : `${COUNT_WORD[count]} ${count === 1 ? "offer" : "offers"} only`;
  return `${lead} — below the three-offer minimum`;
}

const todayIso = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const isoDay = (value) => {
  if (value instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};

/** Whether the Offer's quote has lapsed: on and after its valid-until date. No date, never. */
export function isExpired(offer, today = todayIso()) {
  if (!offer || isBlank(offer.valid_until)) return false;
  return isoDay(today) >= isoDay(offer.valid_until);
}

const normaliseBrand = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

/**
 * The brand a winning Offer proposes for a Component, or null (#278). A Canvass only ever
 * proposes: Brand is Sales' column, and Sales accepts. Nothing is proposed when there is no
 * winner, the winner names no brand, or the Component already carries it (case and spacing
 * ignored, so "toyota" does not argue with "Toyota").
 */
export function brandProposal(component, winningOffer) {
  const proposed = normaliseBrand(winningOffer?.brand);
  if (!proposed) return null;
  if (normaliseBrand(component?.brand).toLowerCase() === proposed.toLowerCase()) return null;
  return proposed;
}

const COMPANY_SUFFIX = /\s(inc|corp|corporation|co|company|ltd|limited)$/;

/**
 * A supplier's name for comparing: lower case, punctuation turned to spaces, spacing collapsed and
 * a trailing Inc / Corp / Co / Ltd dropped, so "Redleaf Inc." and "REDLEAF INC" are one name.
 */
export function normaliseSupplierName(value) {
  let name = String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // A suffix can stack ("Acme Co Ltd"), so drop them one at a time.
  for (let next = name.replace(COMPANY_SUFFIX, ""); next !== name; next = name.replace(COMPANY_SUFFIX, "")) name = next;
  return name;
}

const supplierId = (value) => (isBlank(value) || Number.isNaN(Number(value)) ? null : Number(value));

/**
 * Where a PO is placed with someone other than the winning Offer's supplier (#281), or null.
 * `poSupplier` is `{ id, name }` read from the PO's stored Odoo copy; null when none is known (no
 * PO, no IPAS, or no supplier on it). Compared by Odoo id when both sides have one, otherwise by
 * normalised name. Returns `{ poSupplier, winner }` (the names to show) on a mismatch. It only
 * reports: nothing is blocked. With no winner, or nothing to compare by, there is nothing to say.
 */
export function supplierMismatch(winningOffer, poSupplier) {
  if (!poSupplier) return null;
  const poId = supplierId(poSupplier.id);
  const poName = String(poSupplier.name ?? "").trim();
  if (poId === null && !poName) return null;

  const winnerId = supplierId(winningOffer?.odooSupplierId ?? winningOffer?.odoo_supplier_id);
  const winnerName = String(winningOffer?.supplierName ?? winningOffer?.supplier_name ?? "").trim();
  if (!winningOffer || (winnerId === null && !winnerName)) return null;

  const same =
    poId !== null && winnerId !== null
      ? poId === winnerId
      : normaliseSupplierName(poName) === normaliseSupplierName(winnerName);
  if (same) return null;
  return { poSupplier: poName || null, winner: winnerName || null };
}
