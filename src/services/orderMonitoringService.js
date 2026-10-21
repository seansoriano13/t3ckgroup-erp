import { supabase } from "../lib/supabase";
import { IPAS_STATE, IPAS_STATUS_SOURCE } from "../constants/ipas";
import { ORDER_GROUP } from "../constants/orderMonitoring";
import { TRANSMITTAL_RATING } from "../constants/transmittals";
import { orderAgeingRulesService } from "./orderAgeingRulesService";
import { deliveryDeadlineService } from "./deliveryDeadlineService";
import { deadlineMark, earliestDueAt } from "../utils/deliveryDeadline";
import { transmittalService } from "./transmittalService";
import { readSection3Signoffs } from "./ipasSection3Signoffs";
import { finiteNumber } from "../utils/landedCost";
import { ipasCurrency, ipasEntity, ipasSupplier, shapeIpas } from "../utils/ipas";
import { isLandedCostFinal } from "../utils/ipasSignoffs";
import { checkResultOf, daysBetweenManila, orderStanding } from "../utils/orderStanding";
import { inDateOrder } from "../utils/ipasTransmittals";
import { transmittalStateLabel } from "../utils/transmittals";
import { orderStandingInput, submittedSlips } from "../utils/orderAgeing";

/**
 * Order Monitoring (spec #261): what needs doing (#263) and the order register
 * (#264). The ageing rules it reads live in `orderAgeingRulesService`.
 */
export const orderMonitoringService = {
  /**
   * What needs doing (#263): every IPAS the caller can read, cancelled left out,
   * each with its standing. `group` narrows to one of ORDER_GROUP; `today` is
   * the day the waits are counted to (Asia/Manila), defaulting to now. Newest
   * first within a group, worst first for Needs chasing. Never calls Odoo.
   *
   * The register (#264) narrows the same rows, every filter optional and all
   * of them together: `entity`, `source`, `supplier` (exact names), `sorId`,
   * `state` (open or filed) and `search`, which matches the IPAS number, the PO
   * number or an S number of an SOR the order names (any case). Filed orders
   * are in; cancelled ones never are, whatever the state asked for.
   */
  async list({
    group = null,
    entity = null,
    source = null,
    sorId = null,
    supplier = null,
    state = null,
    search = "",
    today = new Date(),
  } = {}) {
    const rows = await loadOrders(today);
    const needle = String(search ?? "").trim().toLowerCase();
    return rows
      .filter((row) => !group || row.group === group)
      .filter((row) => !entity || row.entity === entity)
      .filter((row) => !source || row.source === source)
      .filter((row) => !supplier || row.supplier === supplier)
      .filter((row) => !state || row.state === state)
      .filter((row) => !sorId || row.sors.some((sor) => sor.id === sorId))
      .filter((row) => !needle || matchesSearch(row, needle))
      .sort((a, b) => weightOf(b) - weightOf(a));
  },

  /**
   * The tiles (#263): open IPAS needing chasing, waiting on us, and waiting on
   * someone else, plus the value still open per PO currency (pre-tax, never
   * converted; filed orders leave it out).
   */
  async counts({ today = new Date() } = {}) {
    const rows = await loadOrders(today);
    const open = rows.filter((row) => row.group !== ORDER_GROUP.FILED);
    const valueByCurrency = new Map();
    for (const row of open) {
      const key = row.currency ?? "";
      const entry = valueByCurrency.get(key) ?? { currency: row.currency ?? null, total: 0, count: 0 };
      entry.total += row.value ?? 0;
      entry.count += 1;
      valueByCurrency.set(key, entry);
    }
    return {
      needsChasing: open.filter((row) => row.group === ORDER_GROUP.NEEDS_CHASING).length,
      waitingOnUs: open.filter((row) => row.group === ORDER_GROUP.WAITING_ON_US).length,
      waitingOnOthers: open.filter((row) => row.group === ORDER_GROUP.WAITING_ON_OTHERS).length,
      valueOpen: [...valueByCurrency.values()].sort((a, b) => String(a.currency).localeCompare(String(b.currency))),
    };
  },
};

/** The search box: IPAS number, PO number or an S number, as typed in any case. */
const matchesSearch = (row, needle) =>
  [row.number, row.poNumber, ...row.sors.map((sor) => sor.salesReference)].some((value) =>
    String(value ?? "").toLowerCase().includes(needle),
  );

/** Needs chasing sorts by how far past its rule, everything else by how long it has waited. */
const weightOf = (row) =>
  row.group === ORDER_GROUP.NEEDS_CHASING ? (row.daysPastRule ?? 0) : (row.daysWaiting ?? 0);

/** The IPAS as the list reads it: every non-cancelled row, each with its standing, loaded in bulk. */
async function loadOrders(today) {
  const { data, error } = await supabase
    .from("ipas")
    .select("*")
    .neq("state", IPAS_STATE.CANCELLED)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const ipasRows = data ?? [];
  if (ipasRows.length === 0) return [];

  const ids = ipasRows.map((row) => row.id);
  const [sorsByIpas, paymentsByIpas, costsAt, section3, slipsByIpas, rules, nearDays] = await Promise.all([
    readSors(ids),
    readPayments(ids),
    readCostsCompleteAt(ids),
    readSection3Signoffs(ids),
    transmittalService.forOrders(ids, { includeDrafts: true }),
    orderAgeingRulesService.getRules(),
    deliveryDeadlineService.getNearDays(),
  ]);
  const deadlines = await deliveryDeadlineService.forSors(
    [...sorsByIpas.values()].flatMap((list) => list.map((sor) => sor.opportunity_id)),
  );

  return ipasRows.map((row) => {
    const payments = paymentsByIpas.get(row.id) ?? [];
    const named = slipsByIpas.get(row.id) ?? [];
    const slips = submittedSlips(named);
    const shaped = shapeIpas(row, sorsByIpas.get(row.id) ?? [], {
      payments,
      charges: [],
      options: [],
      documents: [],
      signoffs: [],
      slips,
    });
    const standing = orderStanding(
      orderStandingInput({
        id: row.id,
        state: row.state,
        source: row.source,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        computationStatus: row.computation_status,
        costsCompletedAt: costsAt.get(row.id),
        section3Submitted: section3.submitted.has(row.id),
        section3Approved: section3.approved.has(row.id),
        buyerTrack: shaped.buyerTrack,
        proofPaidOn: latestProofDate(payments),
        arrivedInPhOn: row.arrived_in_ph_on,
        origins: row,
        slips: named,
      }),
      rules,
      today,
    );

    const received = shaped.buyerTrack.find((step) => step.key === "received_in_odoo")?.ticked ?? false;
    const deadline = deadlineMark({
      dueAt: earliestDueAt((sorsByIpas.get(row.id) ?? []).map((sor) => sor.opportunity_id), deadlines),
      receivedInOdoo: received,
      nearDays,
      today,
    });

    return {
      id: row.id,
      number: row.number,
      poNumber: row.po_number,
      source: row.source,
      state: row.state,
      entity: ipasEntity(row),
      supplier: ipasSupplier(row),
      sors: shaped.sors.map((sor) => ({ id: sor.id, salesReference: sor.salesReference, projectTitle: sor.projectTitle })),
      currency: ipasCurrency(row),
      value: poValue(shaped.lines),
      createdAt: row.created_at,
      ageDays: daysBetweenManila(row.created_at, today),
      odooFetchedAt: row.odoo_fetched_at ?? null,
      item: itemOf(shaped.lines),
      buyerTrack: shaped.buyerTrack.map(trackStepOf),
      transmittals: transmittalSummary(row.id, slips),
      group: standing.group,
      next: standing.next,
      waitingSince: standing.waitingSince,
      daysWaiting: standing.daysWaiting,
      ruleDays: standing.ruleDays,
      late: standing.late,
      daysPastRule: standing.daysPastRule,
      deadline,
    };
  });
}

/** Every SOR each IPAS names, from `ipas_sor_headers` (one call for the list). */
async function readSors(ids) {
  const byIpas = new Map();
  const { data, error } = await supabase.rpc("ipas_sor_headers", { p_ipas_ids: ids });
  if (error) throw error;
  for (const row of data ?? []) {
    const list = byIpas.get(row.ipas_id) ?? [];
    list.push(row);
    byIpas.set(row.ipas_id, list);
  }
  return byIpas;
}

/** Each IPAS's payments (for the With P.O.P proof), one query for the list. */
async function readPayments(ids) {
  const byIpas = new Map();
  const { data, error } = await supabase.from("ipas_payments").select("*").in("ipas_id", ids);
  if (error) throw error;
  for (const row of data ?? []) {
    const list = byIpas.get(row.ipas_id) ?? [];
    list.push(row);
    byIpas.set(row.ipas_id, list);
  }
  return byIpas;
}

/**
 * When each IPAS's Landed Cost went final, from its history: the latest
 * header change that set computation status to a final value. Orders whose
 * history doesn't say fall back to their last update in orderStanding.
 */
async function readCostsCompleteAt(ids) {
  const latest = new Map();
  const { data, error } = await supabase
    .from("ipas_events")
    .select("ipas_id, detail, created_at")
    .in("ipas_id", ids)
    .eq("kind", "header_changed");
  if (error) throw error;
  for (const event of data ?? []) {
    const to = event.detail?.fields?.computation_status?.to;
    if (!isLandedCostFinal(to)) continue;
    const previous = latest.get(event.ipas_id);
    if (!previous || event.created_at > previous) latest.set(event.ipas_id, event.created_at);
  }
  return latest;
}

/** The latest payment date that carries proof of payment, or null. */
function latestProofDate(payments) {
  let latest = null;
  for (const payment of payments) {
    if (payment.proof_url && payment.paid_on && (!latest || payment.paid_on > latest)) latest = payment.paid_on;
  }
  return latest;
}

/**
 * One track step as the register draws it. `mark` is pending until the step is
 * ticked; then typed when a person typed its date (Import Clearance, a typed
 * Delivered), otherwise stamped (Odoo, payments, a Transmittal, a hand stamp),
 * the same split the IPAS page's status section shows.
 */
function trackStepOf({ key, label, ticked, partial, source, on }) {
  let mark = "pending";
  if (ticked) mark = source === IPAS_STATUS_SOURCE.TYPED ? "typed" : "stamped";
  return { key, label, ticked, partial: Boolean(partial), mark, on: on ?? null };
}

/** The item column: the first line's name and how many more lines follow. */
function itemOf(lines = []) {
  return { name: lines[0]?.name ?? null, more: Math.max(0, lines.length - 1) };
}

/** The PO's pre-tax total: its lines' subtotals, in the PO's own currency. */
function poValue(lines = []) {
  return lines.reduce((sum, line) => sum + (finiteNumber(line?.price_subtotal) ?? 0), 0);
}

/** How many of this IPAS's lines a Transmittal rated NA, and the slips that name it. */
function transmittalSummary(ipasId, slips) {
  let naCount = 0;
  for (const slip of slips) {
    for (const line of slip.lines ?? []) {
      if (line.ipas_id !== ipasId) continue;
      if (line.wh_rating === TRANSMITTAL_RATING.NA || line.tech_rating === TRANSMITTAL_RATING.NA) naCount += 1;
    }
  }
  const latest = inDateOrder(slips).at(-1) ?? null;
  return {
    count: slips.length,
    naCount,
    latest: latest
      ? {
          id: latest.id,
          number: latest.number,
          state: latest.state,
          stateLabel: transmittalStateLabel(latest.state),
          check: checkResultOf(ipasId, slips),
        }
      : null,
    slips: slips.map((slip) => ({
      id: slip.id,
      number: slip.number,
      state: slip.state,
      stateLabel: transmittalStateLabel(slip.state),
    })),
  };
}
