import { ORDER_GROUP, ORDER_OWNER, ORDER_OWNER_LABELS } from "../constants/orderMonitoring";
import { deadlineMark } from "./deliveryDeadline";
import {
  DASHBOARD_GROUP_HINTS,
  DASHBOARD_GROUP_LABELS,
  DASHBOARD_GROUPS,
  ageDays,
  filterRows,
  ownerKey,
  rowLabel,
} from "./purchasingDashboard";

/**
 * The Purchasing Dashboard's tracker: one row per SOR (or Direct request), one
 * circle per stage of a purchase, and the one next move. It folds the two
 * things Purchasing used to read on separate tabs, the project work before an
 * order (`purchasing_dashboard_rows()`, grouped by purchasingDashboard.js) and
 * the orders after it (orderMonitoringService), into a single model. An order
 * joins its SORs through the SORs it names; its stage is Purchased.
 */

/** The life of a purchase, left to right: the four dashboard groups, then Filed. */
export const TRACKER_STAGE = { ...Object.fromEntries(DASHBOARD_GROUPS.map((key) => [key.toUpperCase(), key])), FILED: "filed" };
export const TRACKER_STAGES = [
  ...DASHBOARD_GROUPS.map((key) => ({
    key,
    label: DASHBOARD_GROUP_LABELS[key],
    hint: DASHBOARD_GROUP_HINTS[key],
    unit: "items",
  })),
  { key: TRACKER_STAGE.FILED, label: "Filed", hint: "IPAS filed, nothing left to do.", unit: "IPAS" },
];
const STAGE_KEYS = TRACKER_STAGES.map((stage) => stage.key);
const LAST_OPEN = DASHBOARD_GROUPS.length - 1;

/** Next-move bands: the SOR's own next move is ours to make, or someone else's. */
export const MOVE_BAND = { NOW: "now", WAITING: "waiting", CLEAR: "clear" };

const NO_SOR = "no-sor";

/** An order whose goods are Received in Odoo is no longer "Purchased (not received)". */
const isReceived = (order) => Boolean(order.buyerTrack?.find((step) => step.key === "received_in_odoo")?.ticked);

/**
 * A Costing Matrix row with no item count is a Bid Decision still pending (#891): a move of its own,
 * never an item, so the SOR stays in Still canvassing with nothing counted for it.
 */
const isBidPendingRow = (row) => row.target_kind === "costing_matrix" && row.item_count === 0;

/** What the person on a project record has to do next, by the kind of record and the group it sits in. */
function rowAction(row) {
  if (row.grp === "to_purchase") return "Place the P0";
  if (row.grp === "still_canvassing") {
    if (row.target_kind !== "costing_matrix") return "Pick a Canvass winner";
    return isBidPendingRow(row) ? "Bid Decision pending" : "Finish the Bid Decision";
  }
  if (row.grp === "purchased") return "Follow the delivery";
  return "Check the Requested Items";
}

/** The next move on a project record (never an IPAS; an order carries its own). */
export function rowMove(row, today = new Date()) {
  const owner = ORDER_OWNER.PURCHASING;
  return {
    label: rowAction(row),
    owner,
    ownerLabel: ORDER_OWNER_LABELS[owner],
    ours: true,
    late: false,
    days: ageDays(row.since, today),
    ref: rowLabel(row),
  };
}

/** The next move on an open order, as Order Monitoring stands it. `labelOf` words the standing for the viewer. */
export function orderMove(order, labelOf = (next) => next?.label) {
  const owner = order.next?.owner ?? ORDER_OWNER.PURCHASING;
  return {
    label: labelOf(order.next) || "Filed",
    owner,
    ownerLabel: ORDER_OWNER_LABELS[owner],
    ours: owner !== ORDER_OWNER.OTHERS,
    late: Boolean(order.late),
    days: order.daysWaiting ?? 0,
    ref: order.number,
  };
}

/**
 * The one next move for a SOR and the band it sits in. Late first, then
 * anything on our side, then what we are only waiting on; the oldest wins a
 * tie. `more` counts the other open things behind it.
 */
export function nextMoveOf(rows, openOrders, { today = new Date(), labelOf } = {}) {
  const moves = [
    ...rows.filter((row) => row.target_kind !== "ipas").map((row) => rowMove(row, today)),
    ...openOrders.map((order) => orderMove(order, labelOf)),
  ];
  if (moves.length === 0) return { band: MOVE_BAND.CLEAR, more: 0, move: null };
  const weight = (move) => (move.late ? 2 : move.ours ? 1 : 0);
  const best = [...moves].sort((a, b) => weight(b) - weight(a) || b.days - a.days)[0];
  return { band: best.late || best.ours ? MOVE_BAND.NOW : MOVE_BAND.WAITING, more: moves.length - 1, move: best };
}

/**
 * One circle per stage for a SOR. `n` is the work outstanding there (items; for
 * Filed, IPAS). Tone: `open` has work, `late` has work and a late order, `done`
 * has none and the SOR is already past it (a later stage has work, or an IPAS
 * is filed), `none` is a stage not reached.
 */
export function stageStates(sor) {
  const reach = Math.max(sor.furthest, sor.byStage.filed > 0 ? STAGE_KEYS.length - 1 : -1);
  return STAGE_KEYS.map((key, index) => {
    const n = sor.byStage[key];
    if (key === TRACKER_STAGE.FILED) return { key, n, tone: n > 0 ? "done" : "none" };
    if (holdsStage(sor, key)) {
      const late = key === TRACKER_STAGE.PURCHASED && sor.lateCount > 0;
      return { key, n, tone: late ? "late" : "open" };
    }
    return { key, n: 0, tone: index < reach ? "done" : "none" };
  });
}

/** A stage holds work when it counts items, or (Still canvassing) when a Bid Decision is pending (#891). */
function holdsStage(sor, key) {
  return sor.byStage[key] > 0 || (key === TRACKER_STAGE.STILL_CANVASSING && Boolean(sor.bidPending));
}

/** What a SOR has outstanding, in words: "4 not checked, 2 purchased (not received)". */
export function sorSummary(sor) {
  const parts = TRACKER_STAGES.slice(0, LAST_OPEN + 1)
    .map((stage) => (sor.byStage[stage.key] > 0 ? `${sor.byStage[stage.key]} ${stage.label.toLowerCase()}` : null))
    .filter(Boolean);
  if (sor.bidPending) parts.push("Bid Decision pending");
  return parts.join(", ");
}

/** Worst first: late, then the nearest client deadline, then the oldest. */
export function byUrgency(a, b) {
  if (a.lateCount !== b.lateCount) return b.lateCount - a.lateCount;
  const da = a.deadline?.daysLeft ?? Infinity;
  const db = b.deadline?.daysLeft ?? Infinity;
  if (da !== db) return da - db;
  return b.ageDays - a.ageDays;
}

/** How the tracker orders SORs: worst first (the default), or the newest request change or chat message first. */
export const TRACKER_ORDER = { URGENCY: "urgency", RECENT: "recent" };

/** Newest activity first; a SOR with no known activity goes last, then falls back to urgency. */
export function byRecent(a, b) {
  const ta = a.lastActivity ?? -Infinity;
  const tb = b.lastActivity ?? -Infinity;
  if (ta !== tb) return tb - ta;
  return byUrgency(a, b);
}

/** The newest change or chat message (ms) across a SOR's requests, or its orders' creation when it has no request news. */
function lastActivityOf(sor, activity) {
  const times = [];
  for (const row of sor.rows) {
    const at = row.request_id ? activity.get(row.request_id) : null;
    if (at) times.push(new Date(at).getTime());
  }
  for (const order of sor.orders) if (order.createdAt) times.push(new Date(order.createdAt).getTime());
  const valid = times.filter((t) => Number.isFinite(t));
  return valid.length ? Math.max(...valid) : null;
}

/** The pre-tax value still open, per PO currency (never converted), from the open orders. */
export function valueOpenByCurrency(orders) {
  const byCurrency = new Map();
  for (const order of orders) {
    if (order.group === ORDER_GROUP.FILED) continue;
    const key = order.currency ?? "";
    const entry = byCurrency.get(key) ?? { currency: order.currency ?? null, total: 0 };
    entry.total += order.value ?? 0;
    byCurrency.set(key, entry);
  }
  return [...byCurrency.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency)));
}

/** Search matches the S number or project title, or any order the SOR holds by IPAS number, PO number or supplier. */
function matchesSearch(sor, needle) {
  const fields = [sor.salesReference, sor.projectTitle, ...sor.orders.flatMap((o) => [o.number, o.poNumber, o.supplier])];
  return fields.some((value) => String(value ?? "").toLowerCase().includes(needle));
}

export const NEXT_FILTER = { ALL: "ALL", OURS: "ours", WAITING: "waiting", LATE: "late" };

/**
 * The tracker from the two sources.
 *
 * - `rows`      `purchasing_dashboard_rows()`, one per record that owns work.
 * - `orders`    `orderMonitoringService.list()`, every IPAS that is not cancelled.
 * - `deadlines` Map of SOR id to `{ dueAt }`; `nearDays` is N for "near".
 * - `labelOf`   words an order's standing for the viewer (see standingLabel).
 * - `filters`   all optional, all together: `search`, `stage`, `next` (a NEXT_FILTER),
 *               `buyerId`, `canvasserId`, `minAgeDays`, `noCanvass` (project
 *               records), `entity`, `source`, `supplier` (orders; any of them keeps
 *               only the IPAS of matching orders, since only an order has one), and
 *               `showFiled`, which keeps SORs with nothing open.
 *
 * Returns `sors` (worst first), `stages` (the totals the filters leave, before
 * `stage` narrows them, so the stat row stays whole while you pick one) and
 * `orders` (the open orders shown, for the value total).
 */
export function buildTracker({ rows = [], orders = [], deadlines = new Map(), nearDays, labelOf, filters = {}, today = new Date(), order = TRACKER_ORDER.URGENCY, activity = new Map() }) {
  const {
    search = "",
    stage = null,
    next = NEXT_FILTER.ALL,
    buyerId = null,
    canvasserId = null,
    minAgeDays = null,
    noCanvass = false,
    entity = null,
    source = null,
    supplier = null,
    showFiled = false,
  } = filters;

  const orderLevel = Boolean(entity || source || supplier);
  const keptOrders = orders
    .filter((order) => !entity || order.entity === entity)
    .filter((order) => !source || order.source === source)
    .filter((order) => !supplier || order.supplier === supplier)
    .filter((order) => !minAgeDays || order.ageDays >= minAgeDays);
  const keptOrderIds = new Set(keptOrders.map((order) => order.id));
  // Only an order has an entity, a source or a supplier, so those filters keep nothing but the IPAS rows of matching orders.
  const keptRows = filterRows(
    orderLevel ? rows.filter((row) => row.target_kind === "ipas" && keptOrderIds.has(row.target_id)) : rows,
    { buyerId, canvasserId, minAgeDays, noCanvass },
    today,
  );
  // A buyer, canvasser or no-canvass filter narrows project records, so an order alone never adds a SOR then.
  const projectFilter = Boolean(buyerId || canvasserId || noCanvass);
  const ipasRowIds = new Set(rows.filter((row) => row.target_kind === "ipas").map((row) => row.target_id));
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const isRowReceived = (r) => {
    if (isReceived(r)) return true;
    if (r.target_kind === "ipas" && orderById.has(r.target_id)) {
      return isReceived(orderById.get(r.target_id));
    }
    return false;
  };

  const sors = new Map();
  const sorOf = (key, seed) => {
    if (!sors.has(key)) {
      sors.set(key, {
        key,
        oppId: seed.opportunity_id ?? seed.id ?? null,
        salesReference: seed.sales_reference ?? seed.salesReference ?? null,
        projectTitle: seed.project_title ?? seed.projectTitle ?? null,
        rows: [],
        orders: [],
        byStage: Object.fromEntries(STAGE_KEYS.map((k) => [k, 0])),
        bidPending: false,
        oldest: null,
      });
    }
    return sors.get(key);
  };
  const touch = (sor, at) => {
    if (at && (!sor.oldest || at < sor.oldest)) sor.oldest = at;
  };

  for (const row of keptRows) {
    if (row.grp === "purchased" && isRowReceived(row)) continue;
    const sor = sorOf(ownerKey(row), row);
    sor.rows.push(row);
    sor.byStage[row.grp] += row.item_count;
    if (isBidPendingRow(row)) sor.bidPending = true;
    touch(sor, row.since);
  }
  for (const order of keptOrders) {
    const named = order.sors.length ? order.sors : [null];
    for (const s of named) {
      const key = s ? s.id : NO_SOR;
      if (projectFilter && !sors.has(key)) continue;
      const sor = sorOf(key, s ? { id: s.id, salesReference: s.salesReference, projectTitle: s.projectTitle } : {});
      sor.orders.push(order);
      if (order.group === ORDER_GROUP.FILED) sor.byStage.filed += 1;
      // An open order the dashboard's rows do not know still counts, as one item where it stands,
      // unless it is already Received in Odoo: the stage is "Purchased (not received)" (#791).
      else if (!ipasRowIds.has(order.id) && !isReceived(order)) sor.byStage.purchased += 1;
      touch(sor, order.createdAt);
    }
  }

  const shaped = [...sors.values()].map((sor) => {
    const open = sor.orders.filter((order) => order.group !== ORDER_GROUP.FILED && !isReceived(order));
    const dueAt = deadlines.get(sor.oppId)?.dueAt ?? null;
    const furthest = Math.max(-1, ...STAGE_KEYS.slice(0, LAST_OPEN + 1).map((key, i) => (holdsStage(sor, key) ? i : -1)));
    const noSor = sor.key === NO_SOR;
    const direct = !sor.oppId && !noSor;
    return {
      ...sor,
      direct,
      noSor,
      short: direct ? "Direct request" : noSor ? "No SOR" : (sor.salesReference ?? "No S number"),
      name: noSor ? "Orders with no SOR" : direct ? "Direct request" : `${sor.salesReference ?? "No S number"} — ${sor.projectTitle ?? ""}`,
      openOrders: open,
      lateCount: open.filter((order) => order.late).length,
      ageDays: ageDays(sor.oldest, today),
      deadline: dueAt ? deadlineMark({ dueAt, nearDays, today }) : null,
      furthest,
      lastActivity: lastActivityOf(sor, activity),
      outstanding: STAGE_KEYS.slice(0, LAST_OPEN + 1).reduce((n, key) => n + sor.byStage[key], 0),
      next: nextMoveOf(sor.rows, open, { today, labelOf }),
    };
  });

  const needle = String(search ?? "").trim().toLowerCase();
  const beforeStage = shaped
    .filter((sor) => showFiled || sor.outstanding > 0 || sor.bidPending)
    .filter((sor) => !needle || matchesSearch(sor, needle))
    .filter((sor) => {
      if (next === NEXT_FILTER.OURS) return sor.next.band === MOVE_BAND.NOW;
      if (next === NEXT_FILTER.WAITING) return sor.next.band === MOVE_BAND.WAITING;
      if (next === NEXT_FILTER.LATE) return sor.lateCount > 0;
      return true;
    });

  const stages = TRACKER_STAGES.map((definition) => {
    const holders = beforeStage.filter((sor) => holdsStage(sor, definition.key));
    return {
      ...definition,
      count: holders.reduce((n, sor) => n + sor.byStage[definition.key], 0),
      sorCount: holders.length,
      oldestDays: Math.max(0, ...holders.map((sor) => sor.ageDays)),
    };
  });

  const result = beforeStage.filter((sor) => !stage || holdsStage(sor, stage)).sort(order === TRACKER_ORDER.RECENT ? byRecent : byUrgency);
  const shownOrders = [...new Map(result.flatMap((sor) => sor.openOrders).map((order) => [order.id, order])).values()];
  return { sors: result, stages, orders: shownOrders };
}
