import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import {
  IPAS_APPROVAL_LIST,
  IPAS_COMPUTATION_STATUSES,
  IPAS_DOCUMENT_APPLIES_TO,
  IPAS_DOCUMENT_APPLIES_TO_VALUES,
  IPAS_DOCUMENT_USED_FOR,
  IPAS_DOCUMENT_USED_FOR_VALUES,
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
  IPAS_SEND_BACK_SECTIONS,
  IPAS_UNDO_APPROVAL_SECTIONS,
  IPAS_SECTION_7_LIST,
  IPAS_SECTION_7_ROLES,
  ipasSectionLabel,
  ipasSectionName,
  IPAS_SIGNER_LISTS,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_LABELS,
  IPAS_SIGNOFF_SECTIONS,
  IPAS_SIGNOFF_STAGE,
  IPAS_SOURCES,
  IPAS_STATE,
  IPAS_STATE_FILTER_ALL,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
  IPAS_TICK_SIDES,
  IPAS_TYPED_STATUSES,
} from "../constants/ipas";
import { PO_NUMBER_HINT, isValidPoNumber, normalizePoNumber } from "../constants/procurement";
import {
  ipasCurrency,
  ipasEntity,
  ipasSupplier,
  salesReferencesIn,
  shapeBankDetails,
  shapeIpas,
} from "../utils/ipas";
import { isIsoDate, parseAmountInput } from "../utils/ipasPayments";
import { shapeDocuments, unfiledRequiredDocuments } from "../utils/ipasDocuments";
import { isLandedCostFinal, shapeSignoff } from "../utils/ipasSignoffs";
import { rawOf } from "../utils/ipasOptimistic";
import { shapeIpasSummaries } from "../utils/ipasSummary";
import { TRANSMITTAL_STAFF_LISTS } from "../constants/transmittals";

const IPAS_SELECT =
  "*, creator:employees!ipas_created_by_fkey(id, name, avatar_path), canceller:employees!ipas_cancelled_by_fkey(id, name)," +
  " import_clearance_typer:employees!ipas_import_clearance_typed_by_fkey(id, name)," +
  " delivered_typer:employees!ipas_delivered_typed_by_fkey(id, name)," +
  " actual_checker:employees!ipas_actual_checking_by_fkey(id, name)";
const EVENT_SELECT = "*, actor:employees!ipas_events_actor_id_fkey(id, name, avatar_path)";
const PAYMENT_SELECT = "*, creator:employees!ipas_payments_created_by_fkey(id, name)";
const CHARGE_SELECT = "*, creator:employees!ipas_charges_created_by_fkey(id, name)";
const SIGNOFF_SELECT =
  "*, signer:employees!ipas_signoffs_signed_by_fkey(id, name, avatar_path)," +
  " clearer:employees!ipas_signoffs_cleared_by_fkey(id, name)";

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
 * and Landed Cost (#244); bank details and the changed-account flag (#245);
 * documents, Supplier Origin and the buyer track (#246); the sign-offs of
 * sections 1 and 3 and the signer lists behind them (#247); section 7 and
 * Filing, the freeze and reopening (#248). Every IPAS write is an RPC: the
 * database decides who may make it and writes the history row (ADR 0013). The option lists are plain rows under
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
   * `{ id, sales_reference, project_title, current_stage_name, found_in }` (found_in:
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
      current_stage_name: sor.current_stage_name,
      found_in: mentioned[sor.sales_reference] ?? [],
    }));
  },

  /** SORs to attach to a Project IPAS, by Sales Reference or project. */
  async searchSors(term) {
    const search = (term || "").trim();
    if (search.length < 2) return [];
    const { data, error } = await supabase.rpc("ipas_find_sors", { p_refs: null, p_search: search });
    if (error) throw error;
    return (data || []).map((sor) => ({
      id: sor.opportunity_id,
      sales_reference: sor.sales_reference,
      project_title: sor.project_title,
      current_stage_name: sor.current_stage_name,
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

    const { data: rows, error } = await query;
    if (error) throw error;
    // The SOR headers are asked for by id: the database gives none for a null list.
    const sorsByIpas = await readSorHeaders((rows || []).map((row) => row.id));

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

    const [sorsByIpas, events, payments, charges, options, documents, bank, signoffs] = await Promise.all([
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
      supabase.from("ipas_documents").select("*").eq("ipas_id", id).order("created_at", { ascending: true }),
      readBankDetails(id),
      supabase.from("ipas_signoffs").select(SIGNOFF_SELECT).eq("ipas_id", id).order("signed_at", { ascending: true }),
    ]);
    for (const result of [events, payments, charges, options, documents, signoffs]) {
      if (result.error) throw result.error;
    }

    const sors = sorsByIpas.get(id) ?? [];
    const sections = {
      payments: payments.data || [],
      charges: charges.data || [],
      documents: documents.data || [],
      options: options.data || [],
      signoffs: signoffs.data || [],
    };

    return {
      ...shapeIpas(row, sors, sections),
      // The rows it was shaped from, so the page can show an edit before the
      // server has answered (utils/ipasOptimistic.js).
      raw: rawOf({ row, sors, ...sections }),
      // Every option row, inactive ones too: a row that holds a deactivated
      // option still resolves it, and the pickers filter it out for new rows.
      options: options.data || [],
      events: events.data || [],
      // Bank details (#245): null when none is typed OR the caller may not read
      // them; canReadBankDetails says which, so the page shows the section only
      // to people the database lets read it.
      bankDetails: bank.bankDetails,
      canReadBankDetails: bank.canRead,
      refresh: outcome,
    };
  },

  /**
   * An IPAS for printing (#250): what `get` returns, caught up with Odoo first
   * unless the IPAS is filed. A filed IPAS prints its frozen copy and never
   * asks Odoo, so printing it can't move "Odoo has changed since filing" or
   * hold the print on Odoo. A cancelled IPAS has no refresh (`refresh` skips
   * it). When Odoo doesn't answer, the last copy prints and `refresh` says so.
   *
   * `refresh` is the outcome, as in `get`: `{ ok, … }`, or for a filed IPAS
   * `{ ok: true, skipped: true, filed: true, fetchedAt }`.
   */
  async getForPrint(id) {
    if (!id) return null;
    const { data: row, error } = await supabase.from("ipas").select("id, state").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!row) return null;

    const filed = row.state === IPAS_STATE.FILED;
    const outcome = filed ? null : await ipasService.refresh(id);
    const ipas = await ipasService.get(id, { refresh: false });
    if (!ipas) return null;

    return {
      ...ipas,
      refresh: filed ? { ok: true, skipped: true, filed: true, changed: false, fetchedAt: ipas.odoo_fetched_at } : outcome,
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
            title: "Odoo PO changed",
            message: `${number} (${row.po_number}): the Odoo PO's lines or total changed, so its approvals were cleared.`,
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
   *   computationStatus            encoding | encoded | lc_gs_done | lc_odoo_done | checked
   *   googleSheet, ganttChart      section 2's ticks: true or false (never sign-off gated)
   * Half-typed numbers are refused with a sentence (IpasError INVALID), never a
   * cast error. Returns the row.
   */
  async setHeader(
    id,
    { supplierContact, piNumber, piQtAmount, freightServiceId, landedCostSplit, computationStatus, googleSheet, ganttChart } = {},
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
        "The computation status is Encoding, Encoded, LC GS Done, LC Odoo Done or Checked by.",
      );
      fields.computation_status = computationStatus;
    }
    if (googleSheet !== undefined) {
      if (typeof googleSheet !== "boolean") throw new IpasError(IPAS_ERROR.INVALID, "Googlesheet is ticked or not.");
      fields.google_sheet = googleSheet;
    }
    if (ganttChart !== undefined) {
      if (typeof ganttChart !== "boolean") throw new IpasError(IPAS_ERROR.INVALID, "Gantt Chart is ticked or not.");
      fields.gantt_chart = ganttChart;
    }
    if (Object.keys(fields).length === 0) {
      throw new IpasError(IPAS_ERROR.INVALID, "Nothing to change.");
    }
    const { data, error } = await supabase.rpc("ipas_set_header", { p_ipas_id: id, p_fields: fields });
    if (error) throw error;
    return data;
  },

  /** The computation status, set by Purchasing (Finance gives Checked by). Landed Cost is final from LC Odoo Done. */
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

  // ── Bank details (#245) ──────────────────────────────────────────────────

  /**
   * Types or changes the supplier's bank details on an open IPAS (Purchasing
   * access only; Finance can read but not type them). Blank clears a value.
   * The database compares the Account # (spaces and dashes stripped) with the
   * same supplier's most recent other IPAS: a difference flags the account,
   * clears the live section 1 and 3 approvals and records an event, and the
   * preparers of those sections are notified here. The notification names the
   * IPAS and the PO, never an account number.
   *
   * Returns { bankDetails, flagged, accountChanged, approvalsCleared }.
   */
  async setBankDetails(id, { bankName, accountName, accountNumber } = {}) {
    const { data, error } = await supabase.rpc("ipas_set_bank_details", {
      p_ipas_id: id,
      p_bank_name: (bankName || "").trim() || null,
      p_account_name: (accountName || "").trim() || null,
      p_account_number: (accountNumber || "").trim() || null,
    });
    if (error) throw error;

    const preparerIds = data?.preparer_ids ?? [];
    if (preparerIds.length > 0) {
      const { data: ipas } = await supabase.from("ipas").select("number, po_number").eq("id", id).maybeSingle();
      const label = ipas?.number ? `${ipas.number} (${ipas.po_number})` : "An IPAS";
      await Promise.all(
        preparerIds.map((recipient_id) =>
          notificationService.createNotification({
            recipient_id,
            type: IPAS_NOTIFICATION.ACCOUNT_FLAGGED,
            title: "Account # flagged",
            message: `${label}: the supplier's account number differs from their last IPAS, so its approvals were cleared.`,
            reference_id: id,
          }),
        ),
      );
    }

    return {
      bankDetails: shapeBankDetails(data?.bank_details),
      flagged: Boolean(data?.flagged),
      accountChanged: Boolean(data?.account_changed),
      approvalsCleared: data?.approvals_cleared ?? [],
    };
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

  // ── Documents (#246) ─────────────────────────────────────────────────────

  /**
   * Adds a row for every active document kind matching the IPAS's Source that it
   * doesn't have yet (Purchasing). A new IPAS already got these when it was
   * raised; this catches kinds added to the list since. Rows already there are
   * left as they are. Returns the labels added.
   */
  async suggestDocuments(id) {
    const { data, error } = await supabase.rpc("ipas_suggest_documents", { p_ipas_id: id });
    if (error) throw error;
    return data?.added ?? [];
  },

  /**
   * Adds a document to an open IPAS (Purchasing): a document kind (`kindId`) or
   * a hand-added one with its own name (`label`), never both. `attachmentUrl`
   * is the uploaded file's link, optional. A kind or a name appears once per
   * IPAS. Returns the row.
   */
  async addDocument(id, { kindId = null, label = "", attachmentUrl = "" } = {}) {
    const name = (label || "").trim();
    if (kindId && name) throw new IpasError(IPAS_ERROR.INVALID, "Pick a document kind or type a name, not both.");
    if (!kindId && !name) throw new IpasError(IPAS_ERROR.INVALID, "Pick a document kind or type the document's name.");
    const { data, error } = await supabase.rpc("ipas_add_document", {
      p_ipas_id: id,
      p_kind_id: kindId || null,
      p_label: name || null,
      p_attachment_url: (attachmentUrl || "").trim() || null,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Attaches a file to a document (Purchasing), or removes it with a blank
   * `attachmentUrl`. The link comes from the Cloudinary upload, as a payment's
   * proof does. Returns the row.
   */
  async setDocument(documentId, { attachmentUrl = "" } = {}) {
    const { data, error } = await supabase.rpc("ipas_set_document_attachment", {
      p_document_id: documentId,
      p_attachment_url: (attachmentUrl || "").trim() || null,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Ticks (or, with `value: false`, unticks) one side of a document. `side` is
   * "purchasing" (Purchasing has it: Purchasing access) or "finance" (Finance
   * has it: Finance access). Neither flag ticks for the other; the database
   * refuses it (42501), and the tick is kept in history with who made it.
   * Returns the row.
   */
  async tickDocument(documentId, side, value = true) {
    requireOneOf(side, IPAS_TICK_SIDES, "Tick Purchasing has it or Finance has it.");
    const { data, error } = await supabase.rpc("ipas_tick_document", {
      p_document_id: documentId,
      p_side: side,
      p_value: Boolean(value),
    });
    if (error) throw error;
    return data;
  },

  /**
   * Removes a document row that was added by hand (Purchasing), unless Finance
   * has ticked it. A row with a document kind (suggested, or picked from the
   * list) can't be removed: the database refuses it. History keeps what was
   * removed.
   */
  async removeDocument(documentId) {
    const { data, error } = await supabase.rpc("ipas_remove_document", { p_document_id: documentId });
    if (error) throw error;
    return data;
  },

  // ── Supplier Origin, the buyer track and Item Location (#246) ───────────

  /**
   * Types the Supplier Origin dates of an Import IPAS (Purchasing): any of
   * `{ shippedOut, onboard, arrivedInPh, arrivedInWhs }`, each `YYYY-MM-DD` or
   * blank to clear; keys left out are untouched. A Local IPAS refuses them (the
   * database does, twice over). Half-typed dates are refused with a sentence.
   * Returns the row.
   */
  async setSupplierOrigin(id, dates = {}) {
    const fields = {};
    for (const { field, column, label } of IPAS_SUPPLIER_ORIGIN_FIELDS) {
      const value = dates[field];
      if (value === undefined) continue;
      const text = (value ?? "").trim();
      if (text !== "" && !isIsoDate(text)) throw new IpasError(IPAS_ERROR.INVALID, `${label} must be a date.`);
      fields[column] = text === "" ? null : text;
    }
    if (Object.keys(fields).length === 0) throw new IpasError(IPAS_ERROR.INVALID, "Nothing to change.");
    const { data, error } = await supabase.rpc("ipas_set_supplier_origin", { p_ipas_id: id, p_fields: fields });
    if (error) throw error;
    return data;
  },

  /**
   * Types a buyer-track status (Purchasing): `status` is "import_clearance"
   * (Import IPAS only) or "delivered"; `date` is `YYYY-MM-DD`, or blank to
   * clear. Who typed it and when is kept with it and in history. Returns the row.
   */
  async setTypedStatus(id, status, date) {
    requireOneOf(status, IPAS_TYPED_STATUSES, "Import Clearance and Delivered are the statuses you type.");
    const text = (date ?? "").trim();
    if (text !== "" && !isIsoDate(text)) throw new IpasError(IPAS_ERROR.INVALID, "Give a date.");
    const { data, error } = await supabase.rpc("ipas_set_typed_status", {
      p_ipas_id: id,
      p_status: status,
      p_date: text === "" ? null : text,
    });
    if (error) throw error;
    return data;
  },

  /**
   * Stamps Actual Checking (Purchasing), or clears the stamp with
   * `{ stamped: false }`. The stamp is who and when, and is kept in history.
   * Stamping twice changes nothing. Returns the row.
   */
  async stampActualChecking(id, { stamped = true } = {}) {
    const { data, error } = await supabase.rpc("ipas_stamp_actual_checking", {
      p_ipas_id: id,
      p_stamped: Boolean(stamped),
    });
    if (error) throw error;
    return data;
  },

  /** The typed Item Location (an active `item_location` option), or null to clear it. Returns the row. */
  async setItemLocation(id, optionId) {
    const { data, error } = await supabase.rpc("ipas_set_item_location", {
      p_ipas_id: id,
      p_option_id: optionId || null,
    });
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
  async saveOption({ id = null, list, label, appliesTo, usedFor }) {
    requireOneOf(list, Object.values(IPAS_OPTION_LIST), "Pick a list.");
    const name = (label || "").trim();
    if (!name) {
      throw new IpasError(IPAS_ERROR.INVALID, `Type the ${IPAS_OPTION_LIST_NOUNS[list] ?? "option"}'s name.`);
    }

    // A document kind is always marked: which Source it is suggested for, and
    // whether it is documentation, filing or both. Other lists carry neither.
    const marks = {};
    if (list === IPAS_OPTION_LIST.DOCUMENT_KIND) {
      if (appliesTo !== undefined) {
        requireOneOf(appliesTo, IPAS_DOCUMENT_APPLIES_TO_VALUES, "Pick Import, Local or both for the document kind.");
        marks.applies_to = appliesTo;
      }
      if (usedFor !== undefined) {
        requireOneOf(usedFor, IPAS_DOCUMENT_USED_FOR_VALUES, "Pick documentation, filing or both for the document kind.");
        marks.used_for = usedFor;
      }
    }

    const current = await ipasService.listOptions(list);
    const clash = current.find((o) => o.id !== id && String(o.label).trim().toLowerCase() === name.toLowerCase());
    if (clash) throw new IpasError(IPAS_ERROR.INVALID, `"${clash.label}" is already on the list.`);

    if (id) {
      const { data, error } = await supabase
        .from("ipas_options")
        .update({ label: name, ...marks })
        .eq("id", id)
        .select()
        .single();
      // An option a filed IPAS uses keeps its name and marks: the database
      // refuses (55000) for everyone. Say so in a sentence the page can show.
      if (error?.code === "55000") {
        throw new IpasError(
          IPAS_ERROR.OPTION_ON_FILED,
          `"${name}" is used on a filed IPAS and can't be changed. Deactivate it and add a new one instead.`,
        );
      }
      if (error) throw error;
      return data;
    }

    const sort = current.reduce((max, o) => Math.max(max, o.sort ?? 0), 0) + 10;
    const { data, error } = await supabase
      .from("ipas_options")
      .insert({
        list,
        label: name,
        sort,
        active: true,
        ...(list === IPAS_OPTION_LIST.DOCUMENT_KIND
          ? {
              applies_to: marks.applies_to ?? IPAS_DOCUMENT_APPLIES_TO.BOTH,
              used_for: marks.used_for ?? IPAS_DOCUMENT_USED_FOR.DOCUMENTATION,
            }
          : {}),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * The ids of the options a filed IPAS uses. Those can be deactivated and
   * reordered but not renamed (nor re-marked); the database enforces it. Empty
   * when the answer can't be had: the database still refuses, with a sentence.
   */
  async listFiledOptionIds() {
    const { data, error } = await supabase.rpc("ipas_filed_option_ids");
    if (error) return [];
    return Array.isArray(data) ? data : [];
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

  // ── Sign-offs (#247) ─────────────────────────────────────────────────────

  /**
   * Gives a sign-off on an open IPAS. Sections 1 and 3: `role` is "prepared"
   * (Purchasing access) or "approved" (the section's list, someone other than
   * the preparer, after Prepared). Section 7 (#248): "received", then "noted"
   * and "checked" in either order, then "approved", which files the IPAS; each
   * is its own list's, and section 7 opens once sections 1 and 3 are approved.
   * The database decides and refuses with its own sentence (42501 not yours to
   * give, 55000 wrong state, Approved before LC Odoo Done included).
   * `declineSignature` signs without the stored signature, so the printed form
   * shows the name only.
   *
   * Before section 7's Approved files, the Odoo copy is refreshed (a copy Odoo
   * can't be asked for stands), so the filed copy is current whichever screen
   * signs; if that clears approvals, nothing is filed and it says so.
   *
   * Filing only warns about documents. Before section 7's Approved files, this
   * works out the required documents nobody has ticked (`filingWarnings`); when
   * there are any it signs nothing and answers
   *   { signoff: null, notified: 0, filed: false, warnings: [...], needsConfirm: true }
   * and files only when called again with `{ confirm: true }`. Nothing is
   * checked for a call that couldn't file anyway (costs not complete, a step
   * not given): the database's refusal is the answer there.
   *
   * Each step tells exactly the next list, never the signer:
   *   Prepared                        that section's approval list
   *   sections 1 and 3 both approved  the Received list
   *   Received                        the Noted and Checked lists
   *   Noted and Checked both given    the section 7 Approved list
   *
   * Returns { signoff, notified, filed, warnings } — the shaped sign-off, how
   * many people were told, whether this filed the IPAS.
   */
  async sign(id, section, role, { declineSignature = false, confirm = false } = {}) {
    requireSignoffSection(section);
    if (section === 7) {
      requireOneOf(
        role,
        IPAS_SECTION_7_ROLES,
        "Section 7 is Received, then Noted and Checked, then Approved.",
      );
    } else {
      requireOneOf(
        role,
        [IPAS_SIGNOFF_ROLE.PREPARED, IPAS_SIGNOFF_ROLE.APPROVED],
        "A section is Prepared, then Approved.",
      );
    }

    if (section === 7 && role === IPAS_SIGNOFF_ROLE.APPROVED) {
      // Filing freezes the Odoo copy, so file a current one, whichever screen the
      // person signs from. Odoo being down is no reason to stop: the stored copy
      // stands (`refresh` never throws for that).
      const refreshed = await ipasService.refresh(id);
      if (refreshed.ok && (refreshed.approvalsCleared?.length ?? 0) > 0) {
        throw new IpasError(
          IPAS_ERROR.INVALID,
          "The Odoo PO changed since it was last read, so its approvals were cleared and nothing was filed. Get the sections approved again, then file.",
        );
      }
    }

    if (section === 7 && role === IPAS_SIGNOFF_ROLE.APPROVED && !confirm) {
      const { ready, warnings } = await readFilingState(id);
      if (ready && warnings.length > 0) {
        return { signoff: null, notified: 0, filed: false, warnings, needsConfirm: true };
      }
    }

    const { data, error } = await supabase.rpc("ipas_sign", {
      p_ipas_id: id,
      p_section: section,
      p_role: role,
      p_decline_signature: Boolean(declineSignature),
    });
    if (error) throw error;

    const recipients = data?.notify_ids ?? [];
    if (recipients.length > 0) {
      const stage = data?.stage ?? IPAS_SIGNOFF_STAGE.SECTION_PREPARED;
      const label = await readIpasLabel(id, data?.ipas);
      const note = stageNotification(stage, { label, section, role });
      await Promise.all(
        recipients.map((recipient_id) =>
          notificationService.createNotification({
            recipient_id,
            sender_id: data?.signoff?.signed_by ?? null,
            type: note.type,
            title: note.title,
            message: note.message,
            reference_id: id,
          }),
        ),
      );
    }

    return {
      signoff: data?.signoff ? shapeSignoff(data.signoff) : null,
      notified: recipients.length,
      filed: Boolean(data?.filed),
      warnings: [],
    };
  },

  /**
   * The required documents nobody has ticked on an IPAS: the document kinds that
   * match its Source (Import, Local or Both; documentation, filing or both) whose
   * row neither Purchasing nor Finance has ticked. Each is
   * { id, label, usedFor, appliesTo }. Filing warns about these and goes ahead on
   * confirm; the Approve dialog shows them.
   */
  async filingWarnings(id) {
    return (await readFilingState(id)).warnings;
  },

  /**
   * Reopens a filed IPAS (Super Admin only: the database refuses everyone else),
   * with a reason that is kept in history. Clears section 7's sign-offs and
   * returns the IPAS to open; sections 1 and 3 stay approved. Returns
   * { ipas, clearedRoles }.
   */
  async reopen(id, reason) {
    const why = (reason || "").trim();
    if (!why) throw new IpasError(IPAS_ERROR.INVALID, "Give the reason this IPAS is being reopened.");
    const { data, error } = await supabase.rpc("ipas_reopen", { p_ipas_id: id, p_reason: why });
    if (error) throw error;
    return { ipas: data?.ipas ?? null, clearedRoles: data?.cleared_roles ?? [] };
  },

  /**
   * Returns a section with a reason (the Return). Section 1 or 3: clears its
   * live Prepared and Approved (kept as history), clears section 4's live
   * Received, Noted and Checked with them, and notifies whoever prepared it and
   * whoever gave those. Section 7: while it is open and the IPAS isn't filed,
   * clears the live Received, Noted and Checked and notifies whoever gave them.
   * Only a signer of that section may (section 7: anyone on a section 7 list);
   * the database refuses anyone else, a Super Admin off the list included, and
   * a section with nothing signed. The reason is required and is in the
   * notification.
   *
   * Returns { clearedRoles, clearedSection7, notified }.
   */
  async sendBack(id, section, reason) {
    requireSendBackSection(section);
    const why = (reason || "").trim();
    if (!why) throw new IpasError(IPAS_ERROR.INVALID, "Give a reason, so the people who signed know what to fix.");

    const { data, error } = await supabase.rpc("ipas_send_back", {
      p_ipas_id: id,
      p_section: section,
      p_reason: why,
    });
    if (error) throw error;

    const clearedSection7 = data?.cleared_section_7 ?? [];
    const notified = await notifyAbout(id, data, {
      type: IPAS_NOTIFICATION.SENT_BACK,
      title: "IPAS returned",
      message: (label) =>
        `${label}: section ${ipasSectionLabel(section)} was returned. ${why}` +
        (clearedSection7.length > 0 ? ` Section ${ipasSectionLabel("filing")} sign-offs were cleared with it.` : ""),
    });

    return { clearedRoles: data?.cleared_roles ?? [], clearedSection7, notified };
  },

  /**
   * Takes back one section's Approved (section 1 or 3) with a reason. Prepared
   * stays, so the section waits for an approver again. Section 4's live
   * Received, Noted and Checked are cleared with it. Whoever approved it (when
   * not the person undoing) and whoever gave those are told.
   *
   * Returns { clearedSection7, notified }.
   */
  async undoApproval(id, section, reason) {
    if (!IPAS_UNDO_APPROVAL_SECTIONS.includes(section)) {
      throw new IpasError(IPAS_ERROR.INVALID, "Only sections 1 and 2 have an approval to undo.");
    }
    const why = (reason || "").trim();
    if (!why) throw new IpasError(IPAS_ERROR.INVALID, "Give a reason, so the approver knows why.");

    const { data, error } = await supabase.rpc("ipas_undo_approval", {
      p_ipas_id: id,
      p_section: section,
      p_reason: why,
    });
    if (error) throw error;

    const clearedSection7 = data?.cleared_section_7 ?? [];
    const notified = await notifyAbout(id, data, {
      type: IPAS_NOTIFICATION.APPROVAL_UNDONE,
      title: "IPAS approval undone",
      message: (label) =>
        `${label}: the approval of section ${ipasSectionLabel(section)} was undone. ${why}` +
        (clearedSection7.length > 0 ? ` Section ${ipasSectionLabel("filing")} sign-offs were cleared with it.` : ""),
    });

    return { clearedSection7, notified };
  },

  /**
   * The IPAS waiting on this person's signature, oldest waiting first, each as
   *   { id, ipasId, number, poNumber, supplier, purpose, priority, total,
   *     currency, section, role, preparedBy: { id, name, avatarPath },
   *     preparedAt, readyAt, steps }
   *
   * Sections 1 and 3: for each whose approval list they are on, an open IPAS
   * that is Prepared but not Approved and wasn't prepared by them (they can't
   * approve their own). `role` is "approved"; `id` is "<ipas>:<section>".
   *
   * Section 7 (#248): an open IPAS whose sections 1 and 3 are approved and whose
   * next step is one they are on the list for: Received first; Noted and Checked
   * once it is given (a person on both lists gets one row for each); Approved
   * once all three are. `role` is that step and `id` is "<ipas>:7:<role>".
   * `preparedBy` and `preparedAt` (and `readyAt`, the same moment) are who
   * made it ready and when, which is what the queue's clock runs from; `steps`
   * is section 7's four sign-offs for the review sheet's chain.
   */
  async pendingSignoffsFor(employeeId) {
    if (!employeeId) return [];

    const { data: memberships, error: listError } = await supabase
      .from("ipas_signer_lists")
      .select("list_key")
      .eq("employee_id", employeeId);
    if (listError) throw listError;

    const keys = new Set((memberships || []).map((m) => m.list_key));
    const firstSections = [1, 3].filter((section) => keys.has(IPAS_APPROVAL_LIST[section]));
    const sevenRoles = IPAS_SECTION_7_ROLES.filter((role) => keys.has(IPAS_SECTION_7_LIST[role]));
    if (firstSections.length === 0 && sevenRoles.length === 0) return [];

    // Section 7 reads sections 1 and 3 too: it opens on their approvals.
    const sections = sevenRoles.length > 0 ? [1, 3, 7] : firstSections;
    const { data: rows, error } = await supabase
      .from("ipas_signoffs")
      .select(SIGNOFF_SELECT)
      .is("cleared_at", null)
      .in("section", sections);
    if (error) throw error;

    const byIpas = new Map();
    for (const row of rows || []) {
      const entry = byIpas.get(row.ipas_id) ?? new Map();
      entry.set(`${Number(row.section)}/${row.role}`, row);
      byIpas.set(row.ipas_id, entry);
    }

    const waiting = [];
    for (const [ipasId, live] of byIpas) {
      for (const section of firstSections) {
        const prepared = live.get(`${section}/prepared`);
        if (prepared && !live.get(`${section}/approved`) && prepared.signed_by !== employeeId) {
          waiting.push({
            ipasId,
            id: `${ipasId}:${section}`,
            section,
            role: IPAS_SIGNOFF_ROLE.APPROVED,
            madeReady: prepared,
          });
        }
      }

      if (sevenRoles.length > 0) {
        const sections1and3 = [live.get("1/approved"), live.get("3/approved")];
        if (sections1and3.every(Boolean) && !live.get("7/approved")) {
          const received = live.get("7/received");
          const noted = live.get("7/noted");
          const checked = live.get("7/checked");
          const latest = (...signoffs) =>
            signoffs.reduce((a, b) => (String(a.signed_at) >= String(b.signed_at) ? a : b));
          const ready = [];
          if (!received) ready.push([IPAS_SIGNOFF_ROLE.RECEIVED, latest(...sections1and3)]);
          else {
            if (!noted) ready.push([IPAS_SIGNOFF_ROLE.NOTED, received]);
            if (!checked) ready.push([IPAS_SIGNOFF_ROLE.CHECKED, received]);
            if (noted && checked) ready.push([IPAS_SIGNOFF_ROLE.APPROVED, latest(noted, checked)]);
          }
          const steps = IPAS_SECTION_7_ROLES.map((role) => ({
            role,
            label: IPAS_SIGNOFF_ROLE_LABELS[role],
            signoff: live.get(`7/${role}`) ? shapeSignoff(live.get(`7/${role}`)) : null,
          }));
          for (const [role, madeReady] of ready) {
            if (!sevenRoles.includes(role)) continue;
            waiting.push({ ipasId, id: `${ipasId}:7:${role}`, section: 7, role, madeReady, steps });
          }
        }
      }
    }
    if (waiting.length === 0) return [];

    const { data: ipasRows, error: ipasError } = await supabase
      .from("ipas")
      .select("id, number, po_number, purpose, priority, state, odoo_copy")
      .in("id", [...new Set(waiting.map((entry) => entry.ipasId))])
      .eq("state", IPAS_STATE.OPEN);
    if (ipasError) throw ipasError;
    const ipasById = new Map((ipasRows || []).map((ipas) => [ipas.id, ipas]));

    return waiting
      .filter((entry) => ipasById.has(entry.ipasId))
      .map((entry) => {
        const ipas = ipasById.get(entry.ipasId);
        const madeReady = shapeSignoff(entry.madeReady);
        return {
          id: entry.id,
          ipasId: ipas.id,
          number: ipas.number,
          poNumber: ipas.po_number,
          supplier: ipasSupplier(ipas),
          purpose: ipas.purpose,
          priority: ipas.priority,
          total: (ipas.odoo_copy?.lines ?? []).reduce((sum, line) => sum + (Number(line?.price_subtotal) || 0), 0),
          currency: ipasCurrency(ipas),
          section: entry.section,
          role: entry.role,
          preparedBy: madeReady.signedBy,
          preparedAt: madeReady.signedAt,
          readyAt: madeReady.signedAt,
          steps: entry.steps ?? null,
        };
      })
      .sort((a, b) => String(a.readyAt).localeCompare(String(b.readyAt)));
  },

  // ── The signer lists (#247) ──────────────────────────────────────────────

  /**
   * Who may give each sign-off after Prepared: `{ [list_key]: [{ id, employeeId,
   * name, avatarPath, callSign }] }`, every key present (empty when nobody is
   * on it), in the order people were added. Readable by anyone who reads IPAS.
   */
  async getSignerLists() {
    const { data, error } = await supabase
      .from("ipas_signer_lists")
      .select("id, list_key, employee_id, created_at, employee:employees!ipas_signer_lists_employee_id_fkey(id, name, avatar_path, call_sign)")
      .order("created_at", { ascending: true });
    if (error) throw error;

    // The Transmittal staff lists (#252) live in the same table.
    const lists = Object.fromEntries([...IPAS_SIGNER_LISTS, ...TRANSMITTAL_STAFF_LISTS].map((key) => [key, []]));
    for (const row of data || []) {
      if (!lists[row.list_key]) continue;
      lists[row.list_key].push({
        id: row.id,
        employeeId: row.employee_id,
        name: row.employee?.name ?? null,
        avatarPath: row.employee?.avatar_path ?? null,
        callSign: row.employee?.call_sign ?? null,
      });
    }
    return lists;
  },

  /**
   * Replaces one signer list with exactly the given employees, in one step
   * (`ipas_set_signer_list`): Super Admins only, the database refuses everyone
   * else. Each person added or removed is written to the signer-list log.
   * Nobody's past sign-offs change. Returns the list as `getSignerLists` gives it.
   */
  async setSignerList(listKey, employeeIds = []) {
    requireOneOf(listKey, IPAS_SIGNER_LISTS, "That isn't a sign-off list.");
    const wanted = [...new Set((employeeIds || []).filter(Boolean))];

    const { error } = await supabase.rpc("ipas_set_signer_list", {
      p_list_key: listKey,
      p_employee_ids: wanted,
    });
    if (error) throw error;

    return (await ipasService.getSignerLists())[listKey];
  },

  /**
   * Who changed the sign-off lists, newest first (Super Admins read it):
   * `[{ id, listKey, action: "added" | "removed", employeeId, employeeName,
   * actorId, actorName, at }]`. `limit` defaults to the last 20 changes.
   */
  async getSignerListLog({ limit = 20 } = {}) {
    const { data, error } = await supabase
      .from("ipas_signer_list_log")
      .select(
        "id, list_key, action, employee_id, actor_id, created_at, employee:employees!ipas_signer_list_log_employee_id_fkey(name), actor:employees!ipas_signer_list_log_actor_id_fkey(name)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    return (data || []).map((row) => ({
      id: row.id,
      listKey: row.list_key,
      action: row.action,
      employeeId: row.employee_id,
      employeeName: row.employee?.name ?? null,
      actorId: row.actor_id,
      actorName: row.actor?.name ?? null,
      at: row.created_at,
    }));
  },

  // ── The SOR's summary ────────────────────────────────────────────────────

  /**
   * The Project IPAS naming an SOR, as a summary, for anyone who can read the
   * SOR (#249). Each row: `{ id, number, poNumber, supplier, purpose, state,
   * buyerTrack[{ key, label, ticked, partial }], computationStatus,
   * signoffs[{ section, name, steps[{ role, label, done }] }] }`. It carries no
   * payments, charges, bank details or Landed Cost: the database's function
   * returns none, so a Deal Team member with no Purchasing or Finance access
   * can be shown it. No SOR access, or no IPAS, is an empty list.
   *
   * Whether the caller may open the full IPAS is the screen's to say
   * (`canReadIpas`); the full IPAS is gated by the database either way.
   */
  async summariesForSor(opportunityId) {
    if (!opportunityId) return [];
    const { data, error } = await supabase.rpc("ipas_summaries_for_sor", { p_opportunity_id: opportunityId });
    if (error) throw error;
    return shapeIpasSummaries(data);
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

function requireSignoffSection(section) {
  if (!IPAS_SIGNOFF_SECTIONS.includes(section)) {
    throw new IpasError(IPAS_ERROR.INVALID, "Sections 1, 3 and 7 are signed off.");
  }
}

/** Sections 1, 3 and 7 are returned. */
function requireSendBackSection(section) {
  if (!IPAS_SEND_BACK_SECTIONS.includes(section)) {
    throw new IpasError(IPAS_ERROR.INVALID, "Only sections 1, 3 and 7 can be returned.");
  }
}

/** The notification a stage of `ipas_sign` sends to the next list. */
function stageNotification(stage, { label, section, role }) {
  switch (stage) {
    case IPAS_SIGNOFF_STAGE.RECEIVED_READY:
      return {
        type: IPAS_NOTIFICATION.SECTION_7_READY,
        title: "IPAS ready to receive",
        message: `${label}: sections 1 and 3 are approved. Section 7 is ready for Received.`,
      };
    case IPAS_SIGNOFF_STAGE.NOTED_CHECKED_READY:
      return {
        type: IPAS_NOTIFICATION.SECTION_7_READY,
        title: "IPAS ready to note and check",
        message: `${label}: received. Section 7 is ready for Noted and Checked.`,
      };
    case IPAS_SIGNOFF_STAGE.APPROVE_READY:
      return {
        type: IPAS_NOTIFICATION.SECTION_7_READY,
        title: "IPAS ready to approve and file",
        message: `${label}: noted and checked. Approved in section 7 files the IPAS.`,
      };
    default:
      return {
        type: IPAS_NOTIFICATION.SIGNOFF_READY,
        title: "IPAS ready for approval",
        message: `${label}: section ${section} (${ipasSectionName(section)}) is ${IPAS_SIGNOFF_ROLE_LABELS[role].toLowerCase()} and waits for your approval.`,
      };
  }
}

/**
 * What Filing looks at on one IPAS: whether its Approved could file (costs
 * complete, Received, Noted and Checked given) and the required documents nobody
 * has ticked. One read each; nothing is written.
 */
async function readFilingState(id) {
  const [ipas, documents, options, signoffs] = await Promise.all([
    supabase.from("ipas").select("id, source, state, computation_status").eq("id", id).maybeSingle(),
    supabase.from("ipas_documents").select("*").eq("ipas_id", id),
    supabase.from("ipas_options").select("*"),
    supabase
      .from("ipas_signoffs")
      .select("section, role")
      .eq("ipas_id", id)
      .eq("section", 7)
      .is("cleared_at", null),
  ]);
  for (const result of [ipas, documents, options, signoffs]) {
    if (result.error) throw result.error;
  }
  if (!ipas.data) throw new IpasError(IPAS_ERROR.INVALID, "That IPAS isn't there.");

  const given = new Set((signoffs.data || []).map((row) => row.role));
  const ready =
    ipas.data.state === IPAS_STATE.OPEN &&
    isLandedCostFinal(ipas.data.computation_status) &&
    [IPAS_SIGNOFF_ROLE.RECEIVED, IPAS_SIGNOFF_ROLE.NOTED, IPAS_SIGNOFF_ROLE.CHECKED].every((role) => given.has(role));
  const shaped = shapeDocuments(documents.data || [], options.data || []);
  return { ready, warnings: unfiledRequiredDocuments(shaped, ipas.data.source) };
}

/**
 * Tells everyone an RPC's `notify_ids` names, except the person who acted, with
 * `message(label)` as the text. Returns how many were told.
 */
async function notifyAbout(id, data, { type, title, message }) {
  const senderId = data?.actor_id ?? null;
  const recipients = (data?.notify_ids ?? data?.preparer_ids ?? []).filter((recipient) => recipient !== senderId);
  if (recipients.length === 0) return 0;
  const label = await readIpasLabel(id, data?.ipas);
  const text = message(label);
  await Promise.all(
    recipients.map((recipient_id) =>
      notificationService.createNotification({
        recipient_id,
        sender_id: senderId,
        type,
        title,
        message: text,
        reference_id: id,
      }),
    ),
  );
  return recipients.length;
}

/** "TGIPAS_052 (P02552)" for a notification, from the RPC's row or one read. */
async function readIpasLabel(id, row) {
  let ipas = row;
  if (!ipas?.number) {
    const { data } = await supabase.from("ipas").select("number, po_number").eq("id", id).maybeSingle();
    ipas = data;
  }
  return ipas?.number ? `${ipas.number} (${ipas.po_number})` : "An IPAS";
}

function unavailable(po) {
  return new IpasError(
    IPAS_ERROR.ODOO_UNAVAILABLE,
    `Couldn't check ${po} against Odoo just now. The Odoo PO may well exist — try again in a moment.`,
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
      "This Odoo PO is in a foreign currency: give the PHP actually debited, so Landed Cost can use the real rate.",
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

/**
 * An IPAS's bank details, and whether the caller may read them. A caller the
 * database refuses gets no row (row level security), never an error, so
 * `ipas_can_read_bank_details` is what tells "none typed" from "not yours". If
 * it can't be asked, the section stays hidden rather than guessing.
 */
async function readBankDetails(id) {
  const [rows, allowed] = await Promise.all([
    supabase.from("ipas_bank_details").select("*").eq("ipas_id", id).maybeSingle(),
    supabase.rpc("ipas_can_read_bank_details"),
  ]);
  if (rows.error) throw rows.error;
  const canRead = allowed.error ? false : allowed.data === true;
  return { canRead, bankDetails: canRead ? shapeBankDetails(rows.data) : null };
}

function failedRefresh(reason, message, fetchedAt) {
  return { ok: false, reason, message, fetchedAt };
}

function requireOverridable(field) {
  if (!Object.hasOwn(IPAS_OVERRIDE_FIELDS, field)) {
    throw new IpasError(
      IPAS_ERROR.INVALID,
      "Only Entity, Source Doc. and Analytic Dist. can be overridden. Fix anything else in Odoo.",
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
async function readSorHeaders(ipasIds) {
  const byIpas = new Map();
  if (!ipasIds?.length) return byIpas;
  const { data, error } = await supabase.rpc("ipas_sor_headers", { p_ipas_ids: ipasIds });
  if (error) throw error;
  for (const row of data || []) {
    const list = byIpas.get(row.ipas_id) ?? [];
    list.push(row);
    byIpas.set(row.ipas_id, list);
  }
  return byIpas;
}
