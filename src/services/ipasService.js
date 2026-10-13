import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import {
  IPAS_ERROR,
  IPAS_NOTIFICATION,
  IPAS_OVERRIDE_FIELDS,
  IPAS_PRIORITIES,
  IPAS_PURPOSE,
  IPAS_PURPOSES,
  IPAS_SOURCES,
  IPAS_STATE,
  IPAS_STATE_FILTER_ALL,
} from "../constants/ipas";
import { PO_NUMBER_HINT, isValidPoNumber, normalizePoNumber } from "../constants/procurement";
import { ipasEntity, salesReferencesIn, shapeIpas } from "../utils/ipas";

const IPAS_SELECT =
  "*, creator:employees!ipas_created_by_fkey(id, name, avatar_path), canceller:employees!ipas_cancelled_by_fkey(id, name)";
const EVENT_SELECT = "*, actor:employees!ipas_events_actor_id_fkey(id, name, avatar_path)";

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
 * the typed header values follow (#243). Payments, charges, documents and
 * sign-offs extend this object in their own tickets. Every write is an RPC: the database decides who may make it and
 * writes the history row (ADR 0013).
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

    const [sorsByIpas, events] = await Promise.all([
      readSorHeaders([id]),
      supabase
        .from("ipas_events")
        .select(EVENT_SELECT)
        .eq("ipas_id", id)
        .order("created_at", { ascending: true }),
    ]);
    if (events.error) throw events.error;

    return { ...shapeIpas(row, sorsByIpas.get(id) ?? []), events: events.data || [], refresh: outcome };
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
   * Types the supplier contact and/or P.I # (`{ supplierContact, piNumber }`;
   * only the keys given are set, blank clears). A typed value is never
   * overwritten by Odoo; a blank one fills from the next copy. Returns the row.
   */
  async setHeader(id, { supplierContact, piNumber } = {}) {
    const fields = {};
    if (supplierContact !== undefined) fields.supplier_contact = supplierContact ?? "";
    if (piNumber !== undefined) fields.pi_number = piNumber ?? "";
    if (Object.keys(fields).length === 0) {
      throw new IpasError(IPAS_ERROR.INVALID, "Nothing to change.");
    }
    const { data, error } = await supabase.rpc("ipas_set_header", { p_ipas_id: id, p_fields: fields });
    if (error) throw error;
    return data;
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
