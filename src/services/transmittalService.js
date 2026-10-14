import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import {
  TRANSMITTAL_ERROR,
  TRANSMITTAL_NOTIFICATION,
  TRANSMITTAL_PRIORITIES,
  TRANSMITTAL_ORIGIN,
  TRANSMITTAL_LINE_KIND,
} from "../constants/transmittals";
import { shapeTransmittal, transmittalStateLabel } from "../utils/transmittals";

const TRANSMITTAL_SELECT =
  "*, preparer:employees!transmittals_prepared_by_fkey(id, name)," +
  " item_location:ipas_options!transmittals_item_location_id_fkey(id, label)," +
  " products:transmittal_products(option:ipas_options(id, label))," +
  " references:transmittal_references(option:ipas_options(id, label))," +
  " stages:transmittal_stages(*)," +
  " lines:transmittal_lines(*, ipas:ipas!transmittal_lines_ipas_id_fkey(id, number, po_number)," +
  " sor:sales_opportunities!transmittal_lines_opportunity_id_fkey(id, sales_reference, project_title))";

const TRANSMITTAL_LIST_SELECT =
  "id, number, prepared_on, prepared_by, origin, priority, entity, state, submitted_at, created_at," +
  " preparer:employees!transmittals_prepared_by_fkey(id, name), lines:transmittal_lines(id)";

/**
 * A Transmittal error the screen can word: `code` is one of TRANSMITTAL_ERROR.
 * Database refusals come through as the Supabase error, whose message the
 * screen shows as it is.
 */
export class TransmittalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TransmittalError";
    this.code = code;
  }
}

/**
 * The Transmittal seam (#252, spec #251): every change is an RPC, and the
 * database decides who may make it and writes the history row (ADR 0013). The
 * service checks the shape of what it's given, reads the rows the screens need,
 * and sends the notifications the database says are owed.
 */
export const transmittalService = {
  /**
   * Raises a draft. `header` is the TG03 header (origin, originOther,
   * checkWarehouse, checkTechnical, checkOther, priority, entity, productOther,
   * itemLocationId); `productIds` and `referenceIds` are option ids; `lines` are
   * `{ kind, ipasId, odooPoLineId, description, unit, quantity, opportunityId,
   * serialNumbers, boxQuantity }`. Returns `{ id, number, warnings }`.
   */
  async create({ header, productIds = [], referenceIds = [], lines = [] }) {
    const payload = checkedPayload(header, lines);
    const { data, error } = await supabase.rpc("transmittal_create", {
      p_fields: payload.fields,
      p_product_ids: productIds,
      p_reference_ids: referenceIds,
      p_lines: payload.lines,
    });
    if (error) throw error;
    return data;
  },

  /** Replaces a draft's header, products, references and lines. Refused once submitted. */
  async updateDraft(id, { header, productIds = [], referenceIds = [], lines = [] }) {
    const payload = checkedPayload(header, lines);
    const { data, error } = await supabase.rpc("transmittal_update_draft", {
      p_transmittal_id: id,
      p_fields: payload.fields,
      p_product_ids: productIds,
      p_reference_ids: referenceIds,
      p_lines: payload.lines,
    });
    if (error) throw error;
    return data;
  },

  /** One Transmittal, shaped for the page (see utils/transmittals.js). Null when it isn't visible. */
  async get(id) {
    const { data, error } = await supabase.from("transmittals").select(TRANSMITTAL_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    return shapeTransmittal(data);
  },

  /**
   * The list: `{ state, priority, preparedBy }`. `state` is a Transmittal state
   * or null for all; `preparedBy` an employee id or null. Newest first. The
   * database returns only what the caller may read.
   */
  async list({ state = null, priority = null, preparedBy = null } = {}) {
    let query = supabase.from("transmittals").select(TRANSMITTAL_LIST_SELECT).order("created_at", { ascending: false });
    if (state) query = query.eq("state", state);
    if (priority) query = query.eq("priority", priority);
    if (preparedBy) query = query.eq("prepared_by", preparedBy);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []).map((row) => ({
      id: row.id,
      number: row.number,
      preparedOn: row.prepared_on,
      preparedBy: row.preparer?.name ?? null,
      preparedById: row.prepared_by,
      origin: row.origin,
      priority: row.priority,
      entity: row.entity,
      state: row.state,
      stateLabel: transmittalStateLabel(row.state),
      lineCount: (row.lines ?? []).length,
      submittedAt: row.submitted_at ?? null,
      createdAt: row.created_at,
    }));
  },

  /**
   * The PO lines a preparer may put on a slip, matching `search` on the PO
   * number or the line's name. No prices, supplier or bank columns come back.
   */
  async pickablePoLines(search = "") {
    const { data, error } = await supabase.rpc("transmittal_pickable_po_lines", {
      p_search: (search ?? "").trim() || null,
    });
    if (error) throw error;
    return (data ?? []).map((row) => ({
      ipasId: row.ipas_id,
      ipasNumber: row.ipas_number,
      poNumber: row.po_number,
      odooPoLineId: row.odoo_po_line_id,
      productName: row.product_name,
      quantity: row.quantity == null ? null : Number(row.quantity),
      unit: row.unit,
      entity: row.entity,
      sors: row.sors ?? [],
    }));
  },

  /**
   * Submits a draft. Notifies the first stage's list, which the database names
   * with the members it owes the notice to. Returns `{ id, number, state, notify_list, notify_ids }`.
   */
  async submit(id) {
    const { data, error } = await supabase.rpc("transmittal_submit", { p_transmittal_id: id });
    if (error) throw error;

    const stageName = transmittalStateLabel(data.state);
    await Promise.all(
      (data.notify_ids ?? []).map((recipient_id) =>
        notificationService.createNotification({
          recipient_id,
          type: TRANSMITTAL_NOTIFICATION.SUBMITTED,
          title: `${data.number} is waiting on you`,
          message: `TG03 ${data.number} was submitted and is ${stageName.toLowerCase()}.`,
          reference_id: id,
        }),
      ),
    );
    return data;
  },

  /** Cancels with a reason, until a stage is signed. The preparer hears of it when someone else cancels. */
  async cancel(id, reason) {
    const why = (reason ?? "").trim();
    if (!why) throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Give a reason for cancelling.");
    const { data, error } = await supabase.rpc("transmittal_cancel", { p_transmittal_id: id, p_reason: why });
    if (error) throw error;

    if (data?.notify_id) {
      await notificationService.createNotification({
        recipient_id: data.notify_id,
        type: TRANSMITTAL_NOTIFICATION.CANCELLED,
        title: `${data.number} was cancelled`,
        message: `TG03 ${data.number} was cancelled: ${why}`,
        reference_id: id,
      });
    }
    return data;
  },

  /** Super Admins only, and only before any Transmittal exists: the first TG03 number. */
  async setFirstNumber(n) {
    const value = Number(n);
    if (!Number.isInteger(value) || value < 1) {
      throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "The first number is a whole number from 1.");
    }
    const { data, error } = await supabase.rpc("transmittal_set_first_number", { p_number: value });
    if (error) throw error;
    return data;
  },
};

/** The header and lines as the RPCs take them. Refuses a slip that can't be checked at all. */
function checkedPayload(header = {}, lines = []) {
  const origin = header.origin;
  if (!origin || !Object.values(TRANSMITTAL_ORIGIN).includes(origin)) {
    throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Pick an Origin.");
  }
  if (!header.checkWarehouse && !header.checkTechnical) {
    throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Tick Warehouse or TCA Technical under Checking.");
  }
  if (!TRANSMITTAL_PRIORITIES.includes(header.priority)) {
    throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Pick a Priority.");
  }
  return {
    fields: {
      origin,
      origin_other: header.originOther ?? null,
      check_warehouse: !!header.checkWarehouse,
      check_technical: !!header.checkTechnical,
      check_other: header.checkOther ?? null,
      priority: header.priority,
      entity: header.entity ?? "",
      product_other: header.productOther ?? null,
      item_location_id: header.itemLocationId ?? null,
    },
    lines: lines.map((line) => {
      if (line.kind !== TRANSMITTAL_LINE_KIND.PO_LINE && line.kind !== TRANSMITTAL_LINE_KIND.TYPED) {
        throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Each line is a PO line or a typed line.");
      }
      return {
        kind: line.kind,
        ipas_id: line.ipasId ?? null,
        odoo_po_line_id: line.odooPoLineId ?? null,
        description: line.description ?? null,
        unit: line.unit ?? null,
        quantity: line.quantity,
        opportunity_id: line.opportunityId ?? null,
        serial_numbers: line.serialNumbers ?? null,
        box_quantity: line.boxQuantity ?? null,
      };
    }),
  };
}
