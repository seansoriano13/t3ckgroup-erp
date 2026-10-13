import { supabase } from "../lib/supabase";
import {
  IPAS_ERROR,
  IPAS_PRIORITIES,
  IPAS_PURPOSE,
  IPAS_PURPOSES,
  IPAS_SOURCES,
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
 * Reads and lifecycle land here first; payments, charges, documents,
 * sign-offs, the Odoo refresh and the rest extend this object in their own
 * tickets. Every write is an RPC: the database decides who may make it and
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
   */
  async get(id) {
    if (!id) return null;
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

    return { ...shapeIpas(row, sorsByIpas.get(id) ?? []), events: events.data || [] };
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
