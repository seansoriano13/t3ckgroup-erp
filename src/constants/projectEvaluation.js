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
