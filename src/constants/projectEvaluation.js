/**
 * Project Evaluation — pure logic.
 *
 * No database, no network: every value comes in as an argument and every result
 * goes out as a plain object. Prior art: constants/stageGate.js ↔
 * stageGate.test.js and constants/salesFlow.js ↔ salesFlow.test.js — the
 * domain's own questions are answered by a pure module rather than inside a
 * component or a service.
 *
 * Source: issue #38. Ticket: issue #43.
 *
 * What lives here is everything expressible as a function of its arguments:
 * what the two Inclusion states are, which of them a completeness figure is
 * measured over, and what that figure comes to. Persistence is
 * projectEvaluationService's job and nothing here knows it exists.
 */

import { PROCUREMENT_OUTCOME, normalizeOutcome } from "./procurement"
import { calculateCommissionableRevenue } from "../utils/commission"

// ── Completeness ────────────────────────────────────────────────────────────
// "Is the client's specification answered?" — the question Odoo cannot answer,
// because it bundles a complex product into one order line whose inclusions are
// free text inside the description.

export const COMPLETENESS = {
  COVERED: "COVERED",
  MISSING: "MISSING",
  SUBSTITUTED: "SUBSTITUTED",
  NOT_REQUIRED: "NOT_REQUIRED",
}

/** Display order: the states somebody must act on come first. */
export const COMPLETENESS_VALUES = [
  COMPLETENESS.MISSING,
  COMPLETENESS.SUBSTITUTED,
  COMPLETENESS.COVERED,
  COMPLETENESS.NOT_REQUIRED,
]

export const COMPLETENESS_LABELS = {
  [COMPLETENESS.COVERED]: "Covered",
  [COMPLETENESS.MISSING]: "Missing",
  [COMPLETENESS.SUBSTITUTED]: "Substituted",
  [COMPLETENESS.NOT_REQUIRED]: "Not required",
}

// ── Sourcing ────────────────────────────────────────────────────────────────
// How the item would be obtained. Three values rather than a boolean: an
// earlier draft had `is_source_out`, which collapses the middle case, because a
// stockable item with zero on hand still needs ordering and is explicitly not
// source-out. That middle case is most of purchasing's actual work.

export const SOURCING = {
  STOCKABLE_AVAILABLE: "STOCKABLE_AVAILABLE",
  STOCKABLE_NEEDS_ORDERING: "STOCKABLE_NEEDS_ORDERING",
  SOURCE_OUT: "SOURCE_OUT",
}

/** Display order: least work to most. */
export const SOURCING_VALUES = [
  SOURCING.STOCKABLE_AVAILABLE,
  SOURCING.STOCKABLE_NEEDS_ORDERING,
  SOURCING.SOURCE_OUT,
]

export const SOURCING_LABELS = {
  [SOURCING.STOCKABLE_AVAILABLE]: "In stock",
  [SOURCING.STOCKABLE_NEEDS_ORDERING]: "Stocked — needs ordering",
  [SOURCING.SOURCE_OUT]: "Source out",
}

export const isCompleteness = (value) => COMPLETENESS_VALUES.includes(value)

export const isSourcing = (value) => SOURCING_VALUES.includes(value)

/**
 * Whether a sourcing value may be set given what is already there.
 *
 * Every valid value is reachable from every other, including from nothing.
 * Sourcing is a hand-made assessment of a fact about the world, not a workflow:
 * a purchaser who finds the warehouse empty is correcting an observation, and a
 * state machine that made them explain themselves would only teach them to pick
 * whichever value the machine allowed. This function exists so that "any
 * transition, but only between real values" is asserted somewhere rather than
 * assumed at each call site.
 */
export function canSetSourcing(_from, to) {
  return to === null || to === undefined || isSourcing(to)
}

/**
 * Whether an Inclusion is measured by the completeness figure.
 *
 * NOT_REQUIRED is excluded from BOTH sides of the fraction, rather than counted
 * as answered. The client listed it, we established they do not need it, and it
 * should stop bearing on the question entirely — counting it as covered would
 * let a breakdown reach 100% by dismissing everything in it.
 */
export const countsTowardCompleteness = (inclusion) =>
  inclusion?.completeness !== COMPLETENESS.NOT_REQUIRED

/**
 * How much of the client's specification is answered.
 *
 * `percent` is null, never 0, when there is nothing to measure — an SOR with no
 * Inclusions has not been assessed, which is a different statement from "0% of
 * this spec is covered", and a progress bar that renders the two the same way
 * tells a salesperson their untouched breakdown is failing.
 *
 * SUBSTITUTED counts as answered. The client's requirement has been met, just
 * not with the thing they named — the consequence is that sales must re-price,
 * not that the spec has a hole in it. It is reported separately so the screen
 * can say so.
 */
export function summariseCompleteness(inclusions = []) {
  const rows = Array.isArray(inclusions) ? inclusions : []
  const counted = rows.filter(countsTowardCompleteness)

  const tally = (state) => counted.filter((r) => r?.completeness === state).length

  const covered = tally(COMPLETENESS.COVERED)
  const substituted = tally(COMPLETENESS.SUBSTITUTED)
  const answered = covered + substituted
  const outstanding = counted.length - answered

  return {
    total: rows.length,
    counted: counted.length,
    excluded: rows.length - counted.length,
    covered,
    substituted,
    answered,
    outstanding,
    percent: counted.length === 0 ? null : Math.round((answered / counted.length) * 100),
    isComplete: counted.length > 0 && outstanding === 0,
  }
}

/** The rows still holding the specification open, in the order they were entered. */
export const outstandingInclusions = (inclusions = []) =>
  (Array.isArray(inclusions) ? inclusions : []).filter(
    (r) => countsTowardCompleteness(r) && r?.completeness === COMPLETENESS.MISSING,
  )

// ── Purchasing's answer, in the breakdown's vocabulary ──────────────────────

/**
 * What a resolved Procurement Request says about the Inclusion it came from
 * (issue #45). Null when the outcome says nothing about the specification.
 *
 * This mapping lives here rather than in the procurement service because it is
 * a statement about completeness, and completeness is this module's word. The
 * service's job is to write what this function returns.
 *
 * ALREADY_EXISTS reads as COVERED: purchasing found the item in Odoo under a
 * different name and bought nothing. Nothing was substituted — the client gets
 * exactly what they asked for — so calling it SUBSTITUTED would send sales off
 * to re-price a line that has not changed.
 *
 * IN_PROGRESS maps to MISSING rather than to null. It is the outcome a
 * purchaser reverts to, and reverting an answer has to un-answer the Inclusion;
 * leaving it COVERED would keep a spec reading as satisfied by a request that
 * has gone back to being an open question.
 */
export function completenessForOutcome(outcome) {
  // normalizeOutcome first: rows written by an earlier build still carry
  // ON_ORDER, which 0019 renamed to PURCHASED, and a spec check that silently
  // skipped those rows would be wrong exactly on the oldest deals.
  switch (normalizeOutcome(outcome)) {
    case PROCUREMENT_OUTCOME.PURCHASED:
    case PROCUREMENT_OUTCOME.DELIVERED:
    case PROCUREMENT_OUTCOME.ALREADY_EXISTS:
      return COMPLETENESS.COVERED
    case PROCUREMENT_OUTCOME.SUBSTITUTED:
      return COMPLETENESS.SUBSTITUTED
    case PROCUREMENT_OUTCOME.UNAVAILABLE:
    case PROCUREMENT_OUTCOME.IN_PROGRESS:
      return COMPLETENESS.MISSING
    default:
      return null
  }
}

// ── Canvass (issue #46, Inclusion side #47) ─────────────────────────────────
// The three-or-more supplier comparison, recorded as structured Offers rather
// than an ad-hoc sheet. Everything here is a pure function over an offers
// array; persistence and the database's backstop unique index are the
// service's and the migration's job respectively.

/** Policy: compare at least this many suppliers before choosing one. */
export const MIN_CANVASS_OFFERS = 3

/** Whether signing off this Canvass should warn for sitting under the policy minimum. */
export const canvassNeedsMoreOffers = (offers = []) =>
  (Array.isArray(offers) ? offers : []).length < MIN_CANVASS_OFFERS

/** The Offer currently marked the winner, or null if none is. */
export const winningOffer = (offers = []) =>
  (Array.isArray(offers) ? offers : []).find((offer) => offer?.is_winner) ?? null

/**
 * The offers array after marking `winnerId` the winner — that one id carries
 * `is_winner: true`, every other id in the set carries `is_winner: false`,
 * always exactly one winner. Never two: whichever offer sits at `is_winner`
 * beforehand loses it here, unconditionally.
 *
 * The service performs this as two sequential writes (clear the old winner,
 * then set the new one) so `sor_canvass_offers_one_winner_per_canvass` is
 * never hit transiently. That index is a backstop; this function is the rule.
 */
export function applyWinner(offers = [], winnerId) {
  const list = Array.isArray(offers) ? offers : []
  if (!winnerId || !list.some((offer) => offer?.id === winnerId)) {
    throw new Error("Cannot mark an offer that isn't part of this Canvass as the winner.")
  }
  return list.map((offer) => ({ ...offer, is_winner: offer.id === winnerId }))
}

// ── Cost basis (issue #47) ───────────────────────────────────────────────
// An Inclusion's cost resolves in a fixed priority order — the winning
// Canvass offer, then Odoo's catalog price for a stocked item, then whatever
// was typed in by hand — and is stored as a stamped snapshot (migration
// 0060) rather than read live, so a decision stays reproducible after the
// market moves under it.

export const COST_SOURCE = {
  CANVASS_OFFER: "CANVASS_OFFER",
  ODOO_CATALOG: "ODOO_CATALOG",
  MANUAL: "MANUAL",
}

export const COST_SOURCE_LABELS = {
  [COST_SOURCE.CANVASS_OFFER]: "Canvass winner",
  [COST_SOURCE.ODOO_CATALOG]: "Odoo catalog",
  [COST_SOURCE.MANUAL]: "Manual entry",
}

/**
 * Resolves an Inclusion's cost basis from whatever is available, in the
 * fixed priority order the policy sets. Returns `{ amount: null, source:
 * null }` when none of the three exist yet — a state distinct from a cost of
 * zero, which is why callers must check `amount === null` rather than
 * `!amount` before rendering a number.
 */
export function resolveCost({ winningOfferPrice, odooCatalogPrice, manualAmount } = {}) {
  if (winningOfferPrice !== null && winningOfferPrice !== undefined) {
    return { amount: Number(winningOfferPrice), source: COST_SOURCE.CANVASS_OFFER }
  }
  if (odooCatalogPrice !== null && odooCatalogPrice !== undefined) {
    return { amount: Number(odooCatalogPrice), source: COST_SOURCE.ODOO_CATALOG }
  }
  if (manualAmount !== null && manualAmount !== undefined) {
    return { amount: Number(manualAmount), source: COST_SOURCE.MANUAL }
  }
  return { amount: null, source: null }
}

/**
 * Whole days since a cost figure was stamped, or null when nothing has been
 * stamped yet. The screen's job is to say "no cost yet," never "0 days old."
 */
export function costAgeDays(establishedAt, now = new Date()) {
  if (!establishedAt) return null
  const then = new Date(establishedAt)
  if (Number.isNaN(then.getTime())) return null
  const ms = now.getTime() - then.getTime()
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)))
}

// ── Project Evaluation (issue #48) ──────────────────────────────────────────
// The go/no-go: base cost rolled up from Inclusions against a candidate sales
// price, government deductions when they apply, and the resulting margin.

/**
 * The SOR's base cost, rolled up from its Inclusions' stamped cost basis
 * (migration 0060) times each Inclusion's quantity.
 *
 * `amount` is null — not zero — whenever there is nothing to roll up: no
 * Inclusions at all, or Inclusions that exist but none of them costed yet.
 * `isComplete` says whether every Inclusion has contributed, so a screen can
 * show a partial total as partial rather than as a finished figure.
 */
export function rollUpBaseCost(inclusions = []) {
  const rows = Array.isArray(inclusions) ? inclusions : []
  const costed = rows.filter((row) => row?.cost_amount !== null && row?.cost_amount !== undefined)

  const amount = costed.length === 0
    ? null
    : costed.reduce((sum, row) => sum + Number(row.cost_amount) * (Number(row.quantity) || 1), 0)

  return {
    amount,
    costedCount: costed.length,
    totalCount: rows.length,
    isComplete: rows.length > 0 && costed.length === rows.length,
  }
}

/**
 * The go/no-go figure: candidate revenue — net of the VAT/Withholding/
 * Retention sequence when the client is a government body, untouched
 * otherwise — less base cost, less estimated operating expense. Reuses
 * calculateCommissionableRevenue rather than a second deduction calculation,
 * per issue #48's own decision: two systems computing "what did this deal
 * earn" will disagree, and the one people trust is whichever they saw last.
 *
 * `marginPercent` is measured against net revenue, matching how a margin is
 * conventionally read (profit over what was actually collected, not over the
 * sticker price) — and is null rather than a divide-by-zero when revenue is
 * nothing at all.
 */
export function calculateProjectMargin({
  candidateSalesPrice,
  baseCost,
  estimatedOpex,
  isGovernmentClient,
  vatPercent,
  withholdingPercent,
  retentionPercent,
} = {}) {
  const price = Number(candidateSalesPrice) || 0
  const cost = Number(baseCost) || 0
  const opex = Number(estimatedOpex) || 0

  const netRevenue = isGovernmentClient
    ? calculateCommissionableRevenue(price, { vatPercent, withholdingPercent, retentionPercent })
    : price

  const marginAmount = netRevenue - cost - opex
  const marginPercent = netRevenue > 0 ? (marginAmount / netRevenue) * 100 : null

  return { netRevenue, marginAmount, marginPercent }
}

/**
 * How far the ERP's candidate price sits from Odoo's own order price, once
 * there is an Odoo order to compare against. Null when either side is
 * unknown — an unbound evaluation has no Odoo price to drift from, and that
 * is a different statement from a delta of zero.
 */
export function priceDelta(candidatePrice, odooOrderPrice) {
  if (candidatePrice === null || candidatePrice === undefined) return null
  if (odooOrderPrice === null || odooOrderPrice === undefined) return null
  return Number(odooOrderPrice) - Number(candidatePrice)
}

// ── Actual cost (issue #49) ─────────────────────────────────────────────────
// The purchase orders one project actually spawned, rolled up by Source
// Document, reconciled against local attach/detach overrides
// (sor_purchase_order_links, migration 0062).

/**
 * The purchase orders actually visible for a project: every Odoo match minus
 * whatever has been detached, in the order Odoo returned them. A detach
 * always wins over a fresh Odoo match — that is the entire reason the
 * override is recorded rather than left to the next search to rediscover.
 *
 * `localLinks` is `[{ po_number, origin, is_detached }]` — the small set of
 * rows that exist specifically because they disagree with a plain Odoo
 * search, per migration 0062's own reasoning. A po_number with no override
 * needs no lookup here at all: it is simply whatever `odooOrders` says.
 */
export function visiblePurchaseOrders(odooOrders = [], localLinks = []) {
  const detached = new Set(
    (Array.isArray(localLinks) ? localLinks : [])
      .filter((link) => link?.is_detached)
      .map((link) => link.po_number),
  )

  return (Array.isArray(odooOrders) ? odooOrders : []).filter((order) => !detached.has(order.name))
}

/**
 * The SOR's actual cost: the sum of every visible purchase order's
 * tax-exclusive total. `amount` is null — not zero — when there is nothing to
 * total yet, the same distinction rollUpBaseCost makes for the estimate side.
 */
export function sumActualCost(orders = []) {
  const rows = Array.isArray(orders) ? orders : []
  if (rows.length === 0) return { amount: null, orderCount: 0 }

  return {
    amount: rows.reduce((sum, order) => sum + (Number(order.amount_untaxed) || 0), 0),
    orderCount: rows.length,
  }
}
