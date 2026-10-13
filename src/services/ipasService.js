import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import {
  IPAS_COMPUTATION_STATUSES,
  IPAS_ERROR,
  IPAS_LANDED_COST_SPLITS,
  IPAS_NOTIFICATION,
  IPAS_OPTION_LIST,
  IPAS_OPTION_LIST_NOUNS,
  IPAS_OVERRIDE_FIELDS,
  IPAS_PAYMENT_KINDS,
  IPAS_PRIORITIES,
  IPAS_PURPOSE,
  IPAS_PURPOSES,
  IPAS_SOURCES,
  IPAS_STATE,
  IPAS_STATE_FILTER_ALL,
} from "../constants/ipas";
import { PO_NUMBER_HINT, isValidPoNumber, normalizePoNumber } from "../constants/procurement";
import { ipasEntity, salesReferencesIn, shapeIpas } from "../utils/ipas";
import { isIsoDate, parseAmountInput } from "../utils/ipasPayments";

const IPAS_SELECT =
  "*, creator:employees!ipas_created_by_fkey(id, name, avatar_path), canceller:employees!ipas_cancelled_by_fkey(id, name)";
const EVENT_SELECT = "*, actor:employees!ipas_events_actor_id_fkey(id, name, avatar_path)";
const PAYMENT_SELECT = "*, creator:employees!ipas_payments_created_by_fkey(id, name)";
const CHARGE_SELECT = "*, creator:employees!ipas_charges_created_by_fkey(id, name)";

/**
 * An IPAS error the screen can word: `code` is one of IPAS_ERROR.
 *
 * "Odoo has no such PO" and "Odoo could not be asked" are different codes on
 * purpose. The first is a real answer; the second says nothing about whether
 * the PO exists, and must never read as the first.
 */
export class IpasError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IpasError";
    this.code = code;
  }
}

/**
 * IPAS (spec #241, issue #242): the one seam the app uses for the IPAS.
 *
 * Reads and lifecycle land here first (#242); the Odoo refresh, overrides and
 * the typed header values follow (#243); payments, charges, the option lists
 * and Landed Cost (#244). Documents and sign-offs extend this object in their
 * own tickets. Every IPAS write is an RPC: the database decides who may make it
 * and writes the history row (ADR 0013). The option lists are plain rows under
 * row level security (nobody deletes one).
 *
 * Landed Cost is not stored: `get` works it out from the Odoo copy, the payment
 * and charge rows and the spread and status columns (utils/landedCost.js), so a
 * changed PO, payment or charge shows at once.
 *
 * The Odoo read is `odoo-po-ipas` (read-only). Creating reads the PO first and
 * stores that copy; the database never talks to Odoo.
 */
export const ipasService = {
  // ── The Odoo PO ──────────────────────────────────────────────────────────

  /**
   * Reads a PO from Odoo as the IPAS's stored copy: `{ po, supplier, lines,
   * receipts, bills }`. Throws an IpasError:
   *   PO_INVALID        not "P" and digits (nothing was asked)
   *   PO_NOT_FOUND      Odoo answered, and has no PO of that exact name
   *   ODOO_UNAVAILABLE  Odoo couldn't be asked (not configured, down, timed out)
   */
  async readPurchaseOrder(poNumber) {
    const po = normalizePoNumber(poNumber);
    if (!isValidPoNumber(po)) throw new IpasError(IPAS_ERROR.PO_INVALID, PO_NUMBER_HINT);

    let answer;
    try {
      const { data, error } = await supabase.functions.invoke("odoo-po-ipas", { body: { poNumber: po } });
      if (error) throw error;
      answer = data;
    } catch {
      throw unavailable(po);
    }

    // `success: false` is the function's "could not check".
    if (!answer?.success) throw unavailable(po);
    if (!answer.found) {
      throw new IpasError(IPAS_ERROR.PO_NOT_FOUND, `Odoo has no purchase order named ${po}.`);
    }
    const { po: header, supplier, lines, receipts, bills } = answer;
    return { po: header, supplier, lines: lines ?? [], receipts: receipts ?? null, bills: bills ?? null };
  },

  /**
   * The SORs whose Sales Reference the copy mentions — in the PO's Source
   * Document or in a line's analytic account name — as
   * `{ id, sales_reference, project_title, client_name, found_in }` (found_in:
   * "origin" and/or "analytic"). Only references that name an SOR come back.
   */
  async suggestSors(odooCopy) {
    const mentioned = salesReferencesIn(odooCopy);
    const references = Object.keys(mentioned);
    if (!references.length) return [];

    const { data, error } = await supabase.rpc("ipas_find_sors", { p_refs: references, p_search: null });
    if (error) throw error;
    return (data || []).map((sor) => ({
      id: sor.opportunity_id,
      sales_reference: sor.sales_reference,
      project_title: sor.project_title,
      client_name: sor.client_name,
      found_in: mentioned[sor.sales_reference] ?? [],
    }));
  },

  /** SORs to attach to a Project IPAS, by Sales Reference, project or customer. */
  async searchSors(term) {
    const search = (term || "").trim();
    if (search.length < 2) return [];
    const { data, error } = await supabase.rpc("ipas_find_sors", { p_refs: null, p_search: search });
    if (error) throw error;
    return (data || []).map((sor) => ({
      id: sor.opportunity_id,
      sales_reference: sor.sales_reference,
      project_title: sor.project_title,
      client_name: sor.client_name,
    }));
  },

  /**
   * The live (not cancelled) IPAS already raised for a PO, as `{ id, number,
   * state }`, or null. The database refuses a second one either way; this is
   * so the raise form can say so before asking for the rest.
   */
  async findLive(poNumber) {
    const po = normalizePoNumber(poNumber);
    if (!isValidPoNumber(po)) return null;
    const { data, error } = await supabase
      .from("ipas")
      .select("id, number, state")
      .eq("po_number", po)
      .neq("state", "cancelled")
      .limit(1);
    if (error) throw error;
    return data?.[0] ?? null;
  },

  // ── Raise, list, read ────────────────────────────────────────────────────

  /**
   * Raises an IPAS against an Odoo PO. Reads the PO first and refuses when
   * Odoo doesn't have it (PO_NOT_FOUND) or couldn't be asked
   * (ODOO_UNAVAILABLE); an RFQ is accepted. The database refuses a second live
   * IPAS for the PO (23505) and a Project with no SOR (22023). Returns the
   * new row, with its TGIPAS_ number.
   */
  async create({ poNumber, priority, source, purpose, sorIds = [], remarks = "" }) {
    const po = normalizePoNumber(poNumber);
    if (!isValidPoNumber(po)) throw new IpasError(IPAS_ERROR.PO_INVALID, PO_NUMBER_HINT);
    requireOneOf(priority, IPAS_PRIORITIES, "Pick a Priority.");
    requireOneOf(source, IPAS_SOURCES, "Pick a Source.");
    requireOneOf(purpose, IPAS_PURPOSES, "Pick a Purpose.");
    requireSorsFitPurpose(purpose, sorIds);

    const copy = await ipasService.readPurchaseOrder(po);

    const { data, error } = await supabase.rpc("ipas_create", {
      p_po_number: po,
      p_priority: priority,
      p_source: source,
      p_purpose: purpose,
      p_sor_ids: sorIds,
      p_remarks: remarks || null,
      p_odoo_copy: copy,
    });
    if (error) throw error;
    return data;
  },

  /**
   * The IPAS list: `{ state, entity, purpose }`. `state` is open, filed,
   * cancelled or "all" (the default); `entity` is an Odoo company name (the
   * IPAS's entity); `purpose` is a Purpose. Newest first, each with its SORs.
   * The database returns only what the caller may read.
   */
  async list({ state = IPAS_STATE_FILTER_ALL, entity = null, purpose = null } = {}) {
    let query = supabase.from("ipas").select(IPAS_SELECT).order("created_at", { ascending: false });
    if (state && state !== IPAS_STATE_FILTER_ALL) query = query.eq("state", state);
    if (purpose) query = query.eq("purpose", purpose);

    const [{ data: rows, error }, sorsByIpas] = await Promise.all([query, readSorHeaders()]);
    if (error) throw error;

    return (rows || [])
      .filter((row) => !entity || ipasEntity(row) === entity)
      .map((row) => shapeIpas(row, sorsByIpas.get(row.id) ?? []));
  },

  /**
   * One IPAS with its stored Odoo copy and fetch time, its SORs and its
   * history (oldest first). Null when it doesn't exist or the caller can't
   * read it.
   *
   * Opening an IPAS refreshes the copy first (`refresh`), so what comes back is
   * as current as Odoo allows; when Odoo doesn't answer it is the last copy,
   * and `refresh.ok` is false with the reason. `{ refresh: false }` reads what
   * is stored without asking Odoo (the page does this to paint at once, and
   * refreshes beside it).
   */
  async get(id, { refresh = true } = {}) {
    if (!id) return null;
    const outcome = refresh ? await ipasService.refresh(id) : null;

    const { data: row, error } = await supabase.from("ipas").select(IPAS_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return null;

    const [sorsByIpas, events, payments, charges, options] = await Promise.all([
      readSorHeaders([id]),
      supabase
        .from("ipas_events")
        .select(EVENT_SELECT)
        .eq("ipas_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("ipas_payments")
        .select(PAYMENT_SELECT)
        .eq("ipas_id", id)
        .order("paid_on", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("ipas_charges")
        .select(CHARGE_SELECT)
        .eq("ipas_id", id)
        .order("charged_on", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase.from("ipas_options").select("*"),
    ]);
    for (const result of [events, payments, charges, options]) {
      if (result.error) throw result.error;
    }

    return {
      ...shapeIpas(row, sorsByIpas.get(id) ?? [], {
        payments: payments.data || [],
        charges: charges.data || [],
        options: options.data || [],
      }),
      // Every option row, inactive ones too: a row that holds a deactivated
      // option still resolves it, and the pickers filter it out for new rows.
      options: options.data || [],
      events: events.data || [],
      refresh: outcome,
    };
  },

  // ── The Odoo copy ────────────────────────────────────────────────────────

  /**
   * Refreshes an IPAS's stored copy from Odoo: reads the PO (`odoo-po-ipas`) and
   * hands it to `ipas_record_odoo_copy`, which stores it with its fetch time
   * and a change note, fills a blank contact and P.I #, and, when lines or the
   * total changed, clears the live section 1 and 3 approvals. The preparers of
   * those sections are notified here.
   *
   * Never throws for a refresh that couldn't happen. It answers
   *   { ok: true,  changed, filed, approvalsCleared, fetchedAt }
   *   { ok: true,  skipped: true, fetchedAt }       cancelled IPAS: no refresh
   *   { ok: false, reason, message, fetchedAt }     the last copy stands; reason
   *        is IPAS_ODOO_UNAVAILABLE, IPAS_PO_NOT_FOUND or IPAS_REFRESH_FAILED
   * `fetchedAt` is when the copy now held was fetched. A filed IPAS keeps its
   * frozen copy: only "Odoo has changed since filing" can move.
   */
  async refresh(id) {
    if (!id) return { ok: false, reason: IPAS_ERROR.INVALID, message: "No IPAS.", fetchedAt: null };

    const { data: row, error } = await supabase
      .from("ipas")
      .select("id, po_number, state, odoo_fetched_at")
      .eq("id", id)
      .maybeSingle();
    if (error) return failedRefresh(IPAS_ERROR.REFRESH_FAILED, error.message, null);
    if (!row) return failedRefresh(IPAS_ERROR.INVALID, "That IPAS isn't there.", null);
    if (row.state === IPAS_STATE.CANCELLED) {
      return { ok: true, skipped: true, changed: false, fetchedAt: row.odoo_fetched_at };
    }

    let copy;
    try {
      copy = await ipasService.readPurchaseOrder(row.po_number);
    } catch (failure) {
      return failedRefresh(
        failure?.code ?? IPAS_ERROR.ODOO_UNAVAILABLE,
        failure?.message || "Odoo didn't answer.",
        row.odoo_fetched_at,
      );
    }

    const { data, error: rpcError } = await supabase.rpc("ipas_record_odoo_copy", {
      p_ipas_id: id,
      p_odoo_copy: copy,
    });
    if (rpcError) return failedRefresh(IPAS_ERROR.REFRESH_FAILED, rpcError.message, row.odoo_fetched_at);

    const preparerIds = data?.preparer_ids ?? [];
    if (preparerIds.length > 0) {
      const number = data?.ipas?.number ?? "An IPAS";
      await Promise.all(
        preparerIds.map((recipient_id) =>
          notificationService.createNotification({
            recipient_id,
            type: IPAS_NOTIFICATION.PO_CHANGED,
            title: "PO changed in Odoo",
            message: `${number} (${row.po_number}): the PO's lines or total changed in Odoo, so its approvals were cleared.`,
            reference_id: id,
          }),
        ),
      );
    }

    return {
      ok: true,
      changed: Boolean(data?.changed),
      filed: Boolean(data?.filed),
      approvalsCleared: data?.approvals_cleared ?? [],
      fetchedAt: data?.ipas?.odoo_fetched_at ?? row.odoo_fetched_at,
    };
  },

  /**
   * Overrides Entity (`entity`), Source Doc. (`source_doc`) or Analytic Dist.
   * (`analytic`) on an open IPAS. The override survives every refresh until it
   * is reset, and Odoo's own value stays beside it. Currency, Supplier, item
   * lines and Brand can't be overridden by anyone. Returns the row.
   */
  async overrideField(id, field, value) {
    requireOverridable(field);
    const text = (value || "").trim();
    if (!text) throw new IpasError(IPAS_ERROR.INVALID, "Type a value, or reset the field to Odoo.");
    const { data, error } = await supabase.rpc("ipas_override_field", {
      p_ipas_id: id,
      p_field: field,
      p_value: text,
    });
    if (error) throw error;
    return data;
  },

  /** Resets an overridden field to Odoo's value in one action. Returns the row. */
  async resetOverride(id, field) {
    requireOverridable(field);
    const { data, error } = await supabase.rpc("ipas_reset_override", { p_ipas_id: id, p_field: field });
    if (error) throw error;
    return data;
  },

  /**
   * Types the header values Purchasing owns. Only the keys given are set:
   *   supplierContact, piNumber    text; blank clears (Odoo refills a blank one)
   *   piQtAmount                   the supplier document's amount, in the PO's
   *                                currency; blank clears. Typed, never computed.
   *   freightServiceId             an active freight service, or null to clear
   *   landedCostSplit              value | quantity | equal
   *   computationStatus            encoding | encoded | costs_complete | checked
   * Half-typed numbers are refused with a sentence (IpasError INVALID), never a
   * cast error. Returns the row.
   */
  async setHeader(
    id,
    { supplierContact, piNumber, piQtAmount, freightServiceId, landedCostSplit, computationStatus } = {},
  ) {
    const fields = {};
    if (supplierContact !== undefined) fields.supplier_contact = supplierContact ?? "";
    if (piNumber !== undefined) fields.pi_number = piNumber ?? "";
    if (piQtAmount !== undefined) {
      const parsed = parseAmountInput(piQtAmount);
      if (!parsed.ok) throw new IpasError(IPAS_ERROR.INVALID, "P.I/QT Amount must be a number.");
      fields.pi_qt_amount = parsed.value;
    }
    if (freightServiceId !== undefined) fields.freight_service_id = freightServiceId || null;
    if (landedCostSplit !== undefined) {
      requireOneOf(landedCostSplit, IPAS_LANDED_COST_SPLITS, "Spread Landed Cost by value, by quantity or equally.");
      fields.landed_cost_split = landedCostSplit;
    }
    if (computationStatus !== undefined) {
      requireOneOf(
        computationStatus,
        IPAS_COMPUTATION_STATUSES,
        "The computation status is Encoding, Encoded, Costs complete or Checked by.",
      );
      fields.computation_status = computationStatus;
    }
    if (Object.keys(fields).length === 0) {
      throw new IpasError(IPAS_ERROR.INVALID, "Nothing to change.");
    }
    const { data, error } = await supabase.rpc("ipas_set_header", { p_ipas_id: id, p_fields: fields });
    if (error) throw error;
    return data;
  },

  /** The computation status, set by Purchasing. Landed Cost is final from Costs complete. */
  setComputationStatus(id, status) {
    return ipasService.setHeader(id, { computationStatus: status });
  },

  /** How charges, charge fees and shipping fees are spread: value, quantity or equal. */
  setLandedCostSplit(id, split) {
    return ipasService.setHeader(id, { landedCostSplit: split });
  },

  /** The IPAS's one freight service (an active option), or null to clear it. */
  setFreightService(id, optionId) {
    return ipasService.setHeader(id, { freightServiceId: optionId });
  },

  // ── Payments and charges (#244) ──────────────────────────────────────────

  /**
   * Records a payment on an open IPAS (Purchasing or Finance).
   * `{ kind, paidOn, amount, phpDebited, chargeFeePhp, methodId, checkNo,
   * proofUrl }`: `amount` is in the PO's currency, `phpDebited` is the PHP
   * actually debited and is required on a foreign-currency PO (pass
   * `isPhpPo: false`; the database enforces it either way), and
   * `chargeFeePhp` is always PHP. Returns the payment row.
   */
  async addPayment(id, payment, { isPhpPo = true } = {}) {
    const args = paymentArgs(payment, isPhpPo);
    const { data, error } = await supabase.rpc("ipas_add_payment", { p_ipas_id: id, ...args });
    if (error) throw error;
    return data;
  },

  /** Changes a payment on an open IPAS: the same fields as addPayment, all of them. */
  async updatePayment(paymentId, payment, { isPhpPo = true } = {}) {
    const args = paymentArgs(payment, isPhpPo);
    const { data, error } = await supabase.rpc("ipas_update_payment", { p_payment_id: paymentId, ...args });
    if (error) throw error;
    return data;
  },

  /** Removes a payment from an open IPAS; the history keeps what was removed. */
  async removePayment(paymentId) {
    const { data, error } = await supabase.rpc("ipas_remove_payment", { p_payment_id: paymentId });
    if (error) throw error;
    return data;
  },

  /** Records a charge on an open IPAS: `{ kindId, chargedOn, amountPhp }`, PHP. Returns the row. */
  async addCharge(id, charge) {
    const args = chargeArgs(charge);
    const { data, error } = await supabase.rpc("ipas_add_charge", { p_ipas_id: id, ...args });
    if (error) throw error;
    return data;
  },

  async updateCharge(chargeId, charge) {
    const args = chargeArgs(charge);
    const { data, error } = await supabase.rpc("ipas_update_charge", { p_charge_id: chargeId, ...args });
    if (error) throw error;
    return data;
  },

  async removeCharge(chargeId) {
    const { data, error } = await supabase.rpc("ipas_remove_charge", { p_charge_id: chargeId });
    if (error) throw error;
    return data;
  },

  // ── Option lists (#244) ──────────────────────────────────────────────────

  /**
   * The rows of the option lists, in display order: every list, or just one.
   * Inactive ones are included by default (the settings screen shows them and a
   * row that holds one still resolves it); pass `includeInactive: false` for
   * the choices a new row may pick.
   */
  async listOptions(list = null, { includeInactive = true } = {}) {
    let query = supabase.from("ipas_options").select("*");
    if (list) query = query.eq("list", list);
    if (!includeInactive) query = query.eq("active", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).sort(
      (a, b) =>
        String(a.list).localeCompare(String(b.list)) ||
        (a.sort ?? 0) - (b.sort ?? 0) ||
        String(a.label).localeCompare(String(b.label)),
    );
  },

  /**
   * Adds an option to the end of a list, or renames one (`id`). Writable by
   * Purchasing access and Super Admins only (row level security). A label is
   * unique within its list, ignoring case.
   */
  async saveOption({ id = null, list, label }) {
    requireOneOf(list, Object.values(IPAS_OPTION_LIST), "Pick a list.");
    const name = (label || "").trim();
    if (!name) {
      throw new IpasError(IPAS_ERROR.INVALID, `Type the ${IPAS_OPTION_LIST_NOUNS[list] ?? "option"}'s name.`);
    }

    const current = await ipasService.listOptions(list);
    const clash = current.find((o) => o.id !== id && String(o.label).trim().toLowerCase() === name.toLowerCase());
    if (clash) throw new IpasError(IPAS_ERROR.INVALID, `"${clash.label}" is already on the list.`);

    if (id) {
      const { data, error } = await supabase.from("ipas_options").update({ label: name }).eq("id", id).select().single();
      if (error) throw error;
      return data;
    }

    const sort = current.reduce((max, o) => Math.max(max, o.sort ?? 0), 0) + 10;
    const { data, error } = await supabase
      .from("ipas_options")
      .insert({ list, label: name, sort, active: true })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Deactivates (or reactivates) an option. Options are never deleted: a
   * deactivated one is no longer offered for new rows and stays on the rows
   * that already use it.
   */
  async setOptionActive(id, active) {
    const { data, error } = await supabase
      .from("ipas_options")
      .update({ active: Boolean(active) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  deactivateOption(id) {
    return ipasService.setOptionActive(id, false);
  },

  /** Puts a list's options in the given order (ids, first to last); the rest follow. */
  async reorderOptions(list, orderedIds) {
    const current = await ipasService.listOptions(list);
    const known = new Set(current.map((o) => o.id));
    const ids = (orderedIds || []).filter((optionId) => known.has(optionId));
    const rest = current.map((o) => o.id).filter((optionId) => !ids.includes(optionId));
    const order = [...ids, ...rest];
    const byId = new Map(current.map((o) => [o.id, o]));

    const writes = [];
    order.forEach((optionId, index) => {
      const sort = (index + 1) * 10;
      if (byId.get(optionId).sort !== sort) {
        writes.push(supabase.from("ipas_options").update({ sort }).eq("id", optionId));
      }
    });
    const results = await Promise.all(writes);
    const failed = results.find((r) => r.error);
    if (failed) throw failed.error;
    return order;
  },

  // ── Changes ──────────────────────────────────────────────────────────────

  /**
   * Changes an open IPAS's Purpose and SORs together. A Project needs one or
   * more SORs; any other Purpose takes none. The database refuses a filed or
   * cancelled IPAS. Returns the row.
   */
  async setPurposeAndSors(id, { purpose, sorIds = [] }) {
    requireOneOf(purpose, IPAS_PURPOSES, "Pick a Purpose.");
    requireSorsFitPurpose(purpose, sorIds);
    const { data, error } = await supabase.rpc("ipas_set_purpose_and_sors", {
      p_ipas_id: id,
      p_purpose: purpose,
      p_sor_ids: sorIds,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Cancels an open IPAS, by hand, with a reason. The number is kept and the
   * IPAS stays readable; the PO is free for a new IPAS. A filed IPAS must be
   * reopened first (the database refuses it). Returns the row.
   */
  async cancel(id, reason) {
    const why = (reason || "").trim();
    if (!why) throw new IpasError(IPAS_ERROR.INVALID, "Give a reason for cancelling.");
    const { data, error } = await supabase.rpc("ipas_cancel", { p_ipas_id: id, p_reason: why });
    if (error) throw error;
    return data;
  },
};

function unavailable(po) {
  return new IpasError(
    IPAS_ERROR.ODOO_UNAVAILABLE,
    `Couldn't check ${po} against Odoo just now. The PO may well exist — try again in a moment.`,
  );
}

/** A payment form's values as the RPC's arguments. Refuses half-typed input with a sentence. */
function paymentArgs(payment, isPhpPo) {
  const { kind, paidOn, amount, phpDebited, chargeFeePhp, methodId, checkNo, proofUrl } = payment || {};
  requireOneOf(kind, IPAS_PAYMENT_KINDS, "Pick the kind of payment.");
  if (!isIsoDate(paidOn)) throw new IpasError(IPAS_ERROR.INVALID, "Give the date of the payment.");

  const amountRead = parseAmountInput(amount);
  if (!amountRead.ok || amountRead.value === null || amountRead.value <= 0) {
    throw new IpasError(IPAS_ERROR.INVALID, "The amount must be a number more than zero.");
  }

  const phpRead = parseAmountInput(phpDebited);
  if (!phpRead.ok) throw new IpasError(IPAS_ERROR.INVALID, "PHP debited must be a number.");
  if (!isPhpPo && (phpRead.value === null || phpRead.value <= 0)) {
    throw new IpasError(
      IPAS_ERROR.INVALID,
      "This PO is in a foreign currency: give the PHP actually debited, so Landed Cost can use the real rate.",
    );
  }

  const feeRead = parseAmountInput(chargeFeePhp);
  if (!feeRead.ok) throw new IpasError(IPAS_ERROR.INVALID, "The charge fee must be a number.");
  if (!methodId) throw new IpasError(IPAS_ERROR.INVALID, "Pick the payment method.");

  return {
    p_kind: kind,
    p_paid_on: paidOn,
    p_amount: amountRead.value,
    p_php_debited: isPhpPo ? null : phpRead.value,
    p_charge_fee_php: feeRead.value ?? 0,
    p_method_id: methodId,
    p_check_no: (checkNo || "").trim() || null,
    p_proof_url: (proofUrl || "").trim() || null,
  };
}

function chargeArgs(charge) {
  const { kindId, chargedOn, amountPhp } = charge || {};
  if (!kindId) throw new IpasError(IPAS_ERROR.INVALID, "Pick the kind of charge.");
  if (!isIsoDate(chargedOn)) throw new IpasError(IPAS_ERROR.INVALID, "Give the date of the charge.");
  const read = parseAmountInput(amountPhp);
  if (!read.ok || read.value === null || read.value <= 0) {
    throw new IpasError(IPAS_ERROR.INVALID, "The amount must be a number more than zero.");
  }
  return { p_kind_id: kindId, p_charged_on: chargedOn, p_amount_php: read.value };
}

function failedRefresh(reason, message, fetchedAt) {
  return { ok: false, reason, message, fetchedAt };
}

function requireOverridable(field) {
  if (!Object.hasOwn(IPAS_OVERRIDE_FIELDS, field)) {
    throw new IpasError(
      IPAS_ERROR.INVALID,
      "Only Entity, Source Doc. and Analytic Dist. can be overridden. Fix anything else on the PO in Odoo.",
    );
  }
}

function requireOneOf(value, allowed, message) {
  if (!allowed.includes(value)) throw new IpasError(IPAS_ERROR.INVALID, message);
}

function requireSorsFitPurpose(purpose, sorIds) {
  const count = new Set(sorIds || []).size;
  if (purpose === IPAS_PURPOSE.PROJECT && count === 0) {
    throw new IpasError(IPAS_ERROR.INVALID, "A Project IPAS needs at least one SOR.");
  }
  if (purpose !== IPAS_PURPOSE.PROJECT && count > 0) {
    throw new IpasError(
      IPAS_ERROR.INVALID,
      "An Inventory, Supplies or Events IPAS can't name an SOR. Put the note in Remarks.",
    );
  }
}

/** `ipas_sor_headers` as a Map of ipas id -> its SOR header rows. */
async function readSorHeaders(ipasIds = null) {
  const { data, error } = await supabase.rpc("ipas_sor_headers", { p_ipas_ids: ipasIds });
  if (error) throw error;
  const byIpas = new Map();
  for (const row of data || []) {
    const list = byIpas.get(row.ipas_id) ?? [];
    list.push(row);
    byIpas.set(row.ipas_id, list);
  }
  return byIpas;
}
