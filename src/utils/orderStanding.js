/**
 * Order Monitoring's standing (#263, spec #261): the one next thing an open
 * IPAS is waiting on, who owes it, how long it has waited and whether that is
 * past its step's ageing rule. Pure: no network, no React, no clock. The
 * service and the SOR summary (#265) both call this, so they always agree.
 *
 * The decision order is the spec's and must not change. The first match is the
 * next thing:
 *   1. a line rated NA at its slip's checking stage (unless a later slip rates
 *      the same Odoo PO line GC at its checking stage)
 *   2. a slip whose checking stage isn't complete (owner: the Warehouse or Technical)
 *   3. a slip awaiting Check by
 *   4. costs complete but section 3 (the Landed Cost check) not approved
 *      (owner: the section 3 approval list)
 *   5. costs complete, section 3 approved and not filed ("ready to file")
 *   6. Delivered with no Transmittal naming the IPAS (a draft counts as naming it)
 *   7. the first unstamped buyer-track step
 *   8. every step stamped but costs not complete
 *
 * `order` is the IPAS as the service shapes it (see orderMonitoringService):
 *   id, state, source, createdAt, updatedAt, computationStatus,
 *   costsCompletedAt (when costs went complete, or null),
 *   section3Submitted and section3Approved (section 3, stored 6, has a live Submitted / Approved), buyerTrack (the
 *   shaped items with key, ticked, on, at), proofPaidOn and arrivedInPhOn
 *   ('YYYY-MM-DD' or null), latestSupplierOrigin ({ label, on } or null), and
 *   slips (the raw submitted Transmittal rows that name this IPAS, with stages and
 *   lines) and hasDraftTransmittal (a draft names it: raised, not yet submitted).
 *
 * `rules` is the list `orderAgeingRulesService.getRules()` returns; a step with
 * days null has no rule and never goes late.
 */

import {
  ORDER_GROUP,
  ORDER_OWNER,
} from "../constants/orderMonitoring";
import { IPAS_COSTING_SECTION, IPAS_STATE, ipasSectionNo } from "../constants/ipas";
import {
  TRANSMITTAL_RATING,
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STAFF_LIST_LABELS,
  TRANSMITTAL_STAGE,
  TRANSMITTAL_STATE,
} from "../constants/transmittals";
import { isLandedCostFinal } from "./ipasSignoffs";
import { checkingStageOf, stageRowOf } from "./transmittals";
import { inDateOrder } from "./ipasTransmittals";

const MANILA = "Asia/Manila";
const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: MANILA, year: "numeric", month: "2-digit", day: "2-digit" });

/** The Asia/Manila calendar day of an instant (a Date or a timestamp), as 'YYYY-MM-DD'. */
export function manilaDay(value) {
  if (typeof value === "string" && DATE_ONLY.test(value)) return value;
  return dayFormat.format(new Date(value));
}

/** An instant in ms. A bare date means that day's start in Asia/Manila. Null when unusable. */
function instantOf(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && DATE_ONLY.test(value)) return new Date(`${value}T00:00:00+08:00`).getTime();
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Whole calendar days from `since` to `today` in Asia/Manila, never below zero. */
export function daysBetweenManila(since, today) {
  const from = Date.parse(`${manilaDay(since)}T00:00:00Z`);
  const to = Date.parse(`${manilaDay(today)}T00:00:00Z`);
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

const ruleLookup = (rules) => {
  const days = new Map();
  for (const rule of Array.isArray(rules) ? rules : []) days.set(rule.step, rule.days ?? null);
  return (step) => days.get(step) ?? null;
};

const WAREHOUSE_STAGE = TRANSMITTAL_STAGE.WAREHOUSE_CHECKING;
const flagsOf = (slip) => ({ checkWarehouse: slip.check_warehouse, checkTechnical: slip.check_technical });

/** When a slip's stage was completed, as ms, or null while it is open. */
const completedMs = (slip, stage) => instantOf(stageRowOf(slip, stage)?.completed_at ?? null);

const checkingStage = (slip) => checkingStageOf(flagsOf(slip));

/** The rating a line carries at its slip's checking stage (Technical where the slip has one, else the Warehouse). */
function ratingAtChecking(slip, line) {
  return checkingStage(slip) === TRANSMITTAL_STAGE.TECHNICAL_INSPECTION ? line.tech_rating : line.wh_rating;
}

/** Every NA line of this IPAS at its slip's checking stage, each marked cleared when a later slip rates the same PO line GC there. */
function naLinesOf(orderId, sorted) {
  const found = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const slip = sorted[i];
    for (const line of slip.lines ?? []) {
      if (line.ipas_id !== orderId) continue;
      if (ratingAtChecking(slip, line) !== TRANSMITTAL_RATING.NA) continue;
      const cleared = sorted.slice(i + 1).some((later) =>
        (later.lines ?? []).some(
          (laterLine) =>
            laterLine.odoo_po_line_id === line.odoo_po_line_id &&
            ratingAtChecking(later, laterLine) === TRANSMITTAL_RATING.GC,
        ),
      );
      found.push({ slip, line, cleared });
    }
  }
  return found;
}

/** The first NA line of this IPAS at its slip's checking stage that no later slip has cleared with GC, or null. */
function unresolvedNa(order, slips) {
  return naLinesOf(order.id, inDateOrder(slips)).find((entry) => !entry.cleared) ?? null;
}

/**
 * The check result the register's hand-off column shows for an IPAS (#264):
 *   "open"         the latest Transmittal's checking stage isn't complete
 *   "na"           a line is rated NA at checking and no later slip cleared it
 *   "na_replaced"  every NA was cleared by a later slip rating the line GC
 *   "gc"           the checking stage is complete and no line is NA
 *   null           no Transmittal names the IPAS, or nothing was rated
 * `slips` are the raw Transmittal rows that name the IPAS, with stages and lines.
 */
export function checkResultOf(orderId, slips = []) {
  if (slips.length === 0) return null;
  const sorted = inDateOrder(slips);
  const latest = sorted[sorted.length - 1];
  if (completedMs(latest, checkingStage(latest)) === null) return "open";
  const na = naLinesOf(orderId, sorted);
  if (na.some((entry) => !entry.cleared)) return "na";
  if (na.length > 0) return "na_replaced";
  const rated = sorted.some((slip) =>
    (slip.lines ?? []).some((line) => line.ipas_id === orderId && ratingAtChecking(slip, line) === TRANSMITTAL_RATING.GC),
  );
  return rated ? "gc" : null;
}

/** Who a slip with an open checking stage waits on: the Warehouse first, then Technical. */
function awaitingStageOwner(slip) {
  if (flagsOf(slip).checkWarehouse && !completedMs(slip, WAREHOUSE_STAGE)) return ORDER_OWNER.WAREHOUSE;
  return ORDER_OWNER.TECHNICAL;
}

/** A slip the way a row names and opens it: its id and number. */
const slipRef = (slip) => ({ id: slip.id ?? null, number: slip.number ?? null });

/** "TG03-0012", or a plain "A Transmittal" when the slip has no number yet. */
const slipName = (slip) => slip.number ?? "A Transmittal";

const handedInMs = (slip) => instantOf(slip.submitted_at ?? slip.created_at) ?? Infinity;

/** The oldest of some slips by when they were handed in. */
const oldestSlip = (slips) => slips.reduce((best, slip) => (handedInMs(slip) < handedInMs(best) ? slip : best));

/** The staff list a Transmittal owner stands for. */
const LIST_OF_OWNER = {
  [ORDER_OWNER.WAREHOUSE]: TRANSMITTAL_STAFF_LIST.WAREHOUSE,
  [ORDER_OWNER.TECHNICAL]: TRANSMITTAL_STAFF_LIST.TECHNICAL,
  [ORDER_OWNER.CHECK_BY]: TRANSMITTAL_STAFF_LIST.CHECK_BY,
};

/**
 * The next thing's label for one viewer (#588). `viewerLists` are the Transmittal staff list keys
 * the viewer is on. A Transmittal row the viewer is not on the list for ends "waiting on <list name>";
 * a viewer whose lists are unknown (null) cannot act either. Rows with no list read as they are.
 */
export function standingLabel(next, viewerLists = null) {
  if (!next?.label) return "";
  if (!next.list || (viewerLists ?? []).includes(next.list)) return next.label;
  return `${next.label}, waiting on ${TRANSMITTAL_STAFF_LIST_LABELS[next.list] ?? next.list}`;
}

/** Track steps: the label, owner and waiting text the next thing shows for each unstamped step. */
function trackStep(item, order) {
  switch (item.key) {
    case "purchase_order":
      return { label: "Purchase Order — no PO confirmed yet", owner: ORDER_OWNER.PURCHASING };
    case "with_pop":
      return { label: "With P.O.P — no payment carries proof", owner: ORDER_OWNER.FINANCE };
    case "import_clearance":
      return { label: "Import Clearance — waiting on forwarder or port", owner: ORDER_OWNER.OTHERS };
    case "delivered":
      return {
        label: `Delivered — waiting on ${order.source === "import" ? "supplier or forwarder" : "supplier"}`,
        owner: ORDER_OWNER.OTHERS,
      };
    case "received_in_odoo":
      return { label: "Received in Odoo — waiting on the Warehouse", owner: ORDER_OWNER.WAREHOUSE };
    case "create_bill":
      return { label: "Create Bill — no vendor bill yet", owner: ORDER_OWNER.FINANCE };
    case "actual_checking":
      return { label: "Actual Checking — not stamped yet", owner: ORDER_OWNER.PURCHASING };
    default:
      return { label: item.key, owner: ORDER_OWNER.PURCHASING };
  }
}

/** A track item's own date (typed or stamped), as ms, or null. */
function stampMs(item, order) {
  if (item.key === "with_pop") return instantOf(order.proofPaidOn);
  if (["import_clearance", "delivered", "actual_checking"].includes(item.key)) {
    return instantOf(item.on) ?? instantOf(item.at);
  }
  return null;
}

/** When an unstamped track step's wait began: the latest stamp before it, or the IPAS's creation. */
function trackWaitingSince(track, index, order) {
  const target = track[index];
  let since = instantOf(order.createdAt);
  const consider = (ms) => {
    if (ms !== null && ms > since) since = ms;
  };
  for (let i = 0; i < index; i += 1) consider(stampMs(track[i], order));
  // An Import's Arrived in PH date stands before Import Clearance, Delivered and later.
  if (target.key !== "purchase_order" && target.key !== "with_pop") consider(instantOf(order.arrivedInPhOn));
  return since;
}

/** The next thing, its owner and the moment its wait began (ms). */
function nextThing(order, slips, track) {
  const na = unresolvedNa(order, slips);
  if (na) {
    return {
      label: `${slipName(na.slip)} has NA at checking — resolve with supplier`,
      owner: ORDER_OWNER.PURCHASING,
      slip: slipRef(na.slip),
      list: null,
      step: "check_open",
      since: completedMs(na.slip, checkingStage(na.slip)) ?? instantOf(na.slip.submitted_at ?? na.slip.created_at),
    };
  }

  const pending = slips.filter((slip) => completedMs(slip, checkingStage(slip)) === null);
  if (pending.length > 0) {
    // The owner is the stage each slip waits on. When slips wait on both, the
    // Warehouse is owner (the earlier stage) and the words keep both.
    const owners = new Set(pending.map(awaitingStageOwner));
    const owner = owners.has(ORDER_OWNER.WAREHOUSE) ? ORDER_OWNER.WAREHOUSE : ORDER_OWNER.TECHNICAL;
    // The row names the oldest slip waiting on that owner and opens it; the others are counted.
    const slip = oldestSlip(pending.filter((entry) => awaitingStageOwner(entry) === owner));
    const more = pending.length > 1 ? ` (+${pending.length - 1} more)` : "";
    return {
      label: `${slipName(slip)} needs ${owner === ORDER_OWNER.WAREHOUSE ? "Warehouse" : "Technical"} checking${more}`,
      owner,
      slip: slipRef(slip),
      list: LIST_OF_OWNER[owner],
      step: "check_open",
      since: Math.min(...pending.map((slip) => instantOf(slip.submitted_at ?? slip.created_at) ?? Infinity)),
    };
  }

  const awaiting = slips.filter((slip) => slip.state === TRANSMITTAL_STATE.AWAITING_CHECK);
  if (awaiting.length > 0) {
    const checkedMs = (slip) => completedMs(slip, checkingStage(slip)) ?? Infinity;
    const slip = awaiting.reduce((best, entry) => (checkedMs(entry) < checkedMs(best) ? entry : best));
    return {
      label: `${slipName(slip)} needs Check by`,
      owner: ORDER_OWNER.CHECK_BY,
      slip: slipRef(slip),
      list: LIST_OF_OWNER[ORDER_OWNER.CHECK_BY],
      step: "check_open",
      since: Math.min(...awaiting.map((slip) => completedMs(slip, checkingStage(slip)) ?? Infinity)),
    };
  }

  if (isLandedCostFinal(order.computationStatus)) {
    // The wait starts at the Costs complete event. An order whose history has no such event
    // (set outside the app) falls back to its last update, then its creation.
    const since = instantOf(order.costsCompletedAt) ?? instantOf(order.updatedAt) ?? instantOf(order.createdAt);
    // Filing waits for section 3 (#590). Until Purchasing submits it, Purchasing owes it; once
    // submitted, the section 3 list owes the approval.
    if (order.section3Approved !== true) {
      const submitted = order.section3Submitted === true;
      return {
        label: `Section ${ipasSectionNo(IPAS_COSTING_SECTION)} waiting for ${submitted ? "approval" : "submit"}`,
        owner: submitted ? ORDER_OWNER.SECTION_3_APPROVERS : ORDER_OWNER.PURCHASING,
        step: "section_3_approval",
        since,
      };
    }
    return {
      label: "Costs complete — ready to file",
      owner: ORDER_OWNER.SIGNERS,
      step: "ready_to_file",
      since,
    };
  }

  const delivered = track.find((item) => item.key === "delivered");
  // A draft Transmittal counts as raised: someone has started the hand-off, so Purchasing is not
  // owed a nudge. The spec is silent on drafts; this keeps Purchasing from chasing itself.
  if (delivered?.ticked && slips.length === 0 && !order.hasDraftTransmittal) {
    return {
      label: "Delivered — no Transmittal raised",
      owner: ORDER_OWNER.PURCHASING,
      step: "no_transmittal",
      since: stampMs(delivered, order) ?? instantOf(order.createdAt),
    };
  }

  const index = track.findIndex((item) => !item.ticked);
  if (index >= 0) {
    const item = track[index];
    const shown = trackStep(item, order);
    const detail = item.key === "delivered" && order.source === "import" ? order.latestSupplierOrigin : null;
    return {
      label: shown.label,
      owner: shown.owner,
      step: item.key,
      since: trackWaitingSince(track, index, order),
      detail,
    };
  }

  const stamps = track.map((item) => stampMs(item, order)).filter((ms) => ms !== null);
  return {
    label: "Costs not complete",
    owner: ORDER_OWNER.PURCHASING,
    step: "ready_to_file",
    since: Math.max(instantOf(order.createdAt), ...stamps),
  };
}

/**
 * The standing of one open IPAS:
 *   { group, next: { label, owner, step, detail }, waitingSince, daysWaiting,
 *     ruleDays, late, daysPastRule }
 * `group` is one of ORDER_GROUP. Late orders are Needs chasing whoever owes them.
 * A filed order is Filed and carries no wait.
 */
export function orderStanding(order, rules, today) {
  const ruleFor = ruleLookup(rules);

  if (order.state === IPAS_STATE.FILED) {
    return {
      group: ORDER_GROUP.FILED,
      next: { label: "Filed", owner: null, step: null, detail: null, slip: null, list: null },
      waitingSince: null,
      daysWaiting: null,
      ruleDays: null,
      late: false,
      daysPastRule: null,
    };
  }

  const slips = order.slips ?? [];
  const track = order.buyerTrack ?? [];
  const found = nextThing(order, slips, track);
  const since = Number.isFinite(found.since) ? found.since : instantOf(order.createdAt);
  const daysWaiting = daysBetweenManila(since, today);
  const ruleDays = ruleFor(found.step);
  const late = ruleDays !== null && daysWaiting > ruleDays;

  let group = ORDER_GROUP.WAITING_ON_US;
  if (late) group = ORDER_GROUP.NEEDS_CHASING;
  else if (found.owner === ORDER_OWNER.OTHERS) group = ORDER_GROUP.WAITING_ON_OTHERS;

  return {
    group,
    next: {
      label: found.label,
      owner: found.owner,
      step: found.step,
      detail: found.detail ?? null,
      slip: found.slip ?? null,
      list: found.list ?? null,
    },
    waitingSince: new Date(since).toISOString(),
    daysWaiting,
    ruleDays,
    late,
    daysPastRule: late ? daysWaiting - ruleDays : null,
  };
}
