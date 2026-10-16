import { supabase } from "../lib/supabase";
import { notificationService } from "./notificationService";
import {
  TRANSMITTAL_ERROR,
  TRANSMITTAL_NOTIFICATION,
  TRANSMITTAL_PRIORITIES,
  TRANSMITTAL_ORIGIN,
  TRANSMITTAL_LINE_KIND,
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STAFF_LISTS,
  TRANSMITTAL_OPTION_LIST,
  TRANSMITTAL_RATING,
} from "../constants/transmittals";
import { shapeTransmittal, transmittalStateLabel, tsrOf } from "../utils/transmittals";

/** The raw lines of a list row that either stage rated NA. */
const naLines = (row) =>
  (row.lines ?? []).filter((line) => line.wh_rating === TRANSMITTAL_RATING.NA || line.tech_rating === TRANSMITTAL_RATING.NA);

/** The private bucket for stage pictures and videos (#253). Paths: <transmittal>/<stage>/<uuid>-<name>. */
export const PMS_EVIDENCE_BUCKET = "pms-evidence";
export const PMS_EVIDENCE_MAX_BYTES = 52428800;

const TRANSMITTAL_SELECT =
  "*, preparer:employees!transmittals_prepared_by_fkey(id, name)," +
  " item_location:ipas_options!transmittals_item_location_id_fkey(id, label)," +
  " products:transmittal_products(option:ipas_options(id, label))," +
  " references:transmittal_references(option:ipas_options(id, label))," +
  " odoo_receiver:employees!transmittals_odoo_received_by_fkey(id, name)," +
  " check_by_first:employees!transmittals_check_by_first_id_fkey(id, name, call_sign, signature_path)," +
  " check_by_second:employees!transmittals_check_by_second_id_fkey(id, name, call_sign, signature_path)," +
  " stages:transmittal_stages(*, first_signer:employees!transmittal_stages_first_signer_id_fkey(id, name, signature_path)," +
  " second_signer:employees!transmittal_stages_second_signer_id_fkey(id, name, signature_path))," +
  " evidence:pms_evidence(id, record_id, kind, storage_path, file_name, mime_type, size_bytes, uploaded_by, created_at)," +
  " cleared:transmittal_cleared_signatures(id, kind, stage, slot, signer_id, signer_name, signed_at, other_signer_id," +
  " other_signer_name, receipt_ref, cleared_by, cleared_at, cleared_reason," +
  " clearer:employees!transmittal_cleared_signatures_cleared_by_fkey(id, name))," +
  " lines:transmittal_lines(*, ipas:ipas!transmittal_lines_ipas_id_fkey(id, number, po_number)," +
  " sor:sales_opportunities!transmittal_lines_opportunity_id_fkey(id, sales_reference, project_title)," +
  " wh_in_charge:employees!transmittal_lines_wh_in_charge_id_fkey(id, name)," +
  " tech_in_charge:employees!transmittal_lines_tech_in_charge_id_fkey(id, name))";

const TRANSMITTAL_LIST_SELECT =
  "id, number, prepared_on, prepared_by, origin, priority, entity, state, submitted_at, created_at," +
  " preparer:employees!transmittals_prepared_by_fkey(id, name), lines:transmittal_lines(id, wh_rating, tech_rating)";

/**
 * Fills each line's IPAS and SOR reference from `transmittal_line_refs`. The
 * embedded reads come back empty for a reader who can't read that IPAS or SOR
 * (the Warehouse, Technical, or Purchasing off the deal team), but the slip
 * still names them.
 */
async function withLineRefs(row) {
  const { data, error } = await supabase.rpc("transmittal_line_refs", { p_transmittal_id: row.id });
  if (error) throw error;
  const refs = new Map((data ?? []).map((ref) => [ref.line_id, ref]));
  return {
    ...row,
    lines: (row.lines ?? []).map((line) => {
      const ref = refs.get(line.id);
      if (!ref) return line;
      return {
        ...line,
        ipas: line.ipas ?? (ref.ipas_number ? { id: line.ipas_id, number: ref.ipas_number, po_number: ref.po_number } : null),
        sor:
          line.sor ??
          (ref.sor_id ? { id: ref.sor_id, sales_reference: ref.sor_reference, project_title: ref.sor_project } : null),
      };
    }),
  };
}

/** "Waiting on Warehouse" → "waiting on Warehouse": a stage name mid-sentence keeps its proper nouns. */
const lowerFirst = (text) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text);

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

  /**
   * The submitted, uncancelled Transmittals that carry a PO line of this IPAS,
   * with their stages and ratings (#256). Raw rows, for utils/ipasTransmittals.js.
   * The database returns only what the caller may read.
   */
  async forIpas(ipasId) {
    if (!ipasId) return [];
    const { data: links, error: linkError } = await supabase
      .from("transmittal_lines")
      .select("transmittal_id")
      .eq("ipas_id", ipasId);
    if (linkError) throw linkError;
    const ids = [...new Set((links ?? []).map((row) => row.transmittal_id))];
    if (ids.length === 0) return [];

    const { data, error } = await supabase
      .from("transmittals")
      .select(
        "id, number, prepared_on, created_at, priority, state, check_warehouse, check_technical, item_location_id," +
          " stages:transmittal_stages(stage, completed_at), lines:transmittal_lines(wh_rating, tech_rating)",
      )
      .in("id", ids)
      .neq("state", "draft")
      .neq("state", "cancelled");
    if (error) throw error;
    return data ?? [];
  },

  /** One Transmittal, shaped for the page (see utils/transmittals.js). Null when it isn't visible. */
  async get(id) {
    const { data, error } = await supabase.from("transmittals").select(TRANSMITTAL_SELECT).eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return shapeTransmittal(await withLineRefs(data));
  },

  /**
   * The Technical Service Report of one slip, derived from its Technical
   * inspection stage (#259): null when the slip has none or isn't visible.
   */
  async getTsr(id) {
    const slip = await transmittalService.get(id);
    return tsrOf(slip);
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
      naCount: naLines(row).length,
      hasNa: naLines(row).length > 0,
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
          message: `${data.number} was submitted and is ${lowerFirst(stageName)}.`,
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
        message: `${data.number} was cancelled: ${why}`,
        reference_id: id,
      });
    }
    return data;
  },

  /**
   * Whether the signed-in employee may raise a Transmittal: Purchasing access,
   * or the Warehouse or Logistics list. The database's own rule, so the screen
   * never offers a form the database would refuse.
   */
  async canPrepare() {
    const { data, error } = await supabase.rpc("transmittal_can_prepare");
    if (error) throw error;
    return data === true;
  },

  /** The four Transmittal staff lists the employee is on (ipas_signer_lists keys). Own rows only. */
  async myStaffLists(employeeId) {
    if (!employeeId) return [];
    const { data, error } = await supabase
      .from("ipas_signer_lists")
      .select("list_key")
      .eq("employee_id", employeeId);
    if (error) throw error;
    return (data ?? []).map((row) => row.list_key).filter((key) => TRANSMITTAL_STAFF_LISTS.includes(key));
  },

  /**
   * The Check by list's call signs, for the blank Check by plates on the
   * printed Transmittal (#258): `[{ name, callSign }]`, in list order.
   */
  async checkByRoster() {
    const { data, error } = await supabase
      .from("ipas_signer_lists")
      .select("employees(name, call_sign)")
      .eq("list_key", TRANSMITTAL_STAFF_LIST.CHECK_BY);
    if (error) throw error;
    return (data ?? [])
      .map((row) => row.employees)
      .filter(Boolean)
      .map((e) => ({ name: e.name ?? "", callSign: e.call_sign ?? "" }));
  },

  /** Every active reference option, in order, for the printed reference checklist (#258). */
  async referenceOptions() {
    const { data, error } = await supabase
      .from("ipas_options")
      .select("id, label")
      .eq("list", TRANSMITTAL_OPTION_LIST.REFERENCE)
      .eq("active", true)
      .order("sort", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  /** The active members of one staff list, for a signatory picker: `[{ id, name }]`. */
  async stageListMembers(id, listKey) {
    const { data, error } = await supabase.rpc("transmittal_stage_list_members", {
      p_transmittal_id: id,
      p_list_key: listKey,
    });
    if (error) throw error;
    return data ?? [];
  },

  /**
   * Rates a Warehouse checking stage's lines. `ratings` are
   * `{ lineId, rating ('gc'|'na'), remark, inChargeId, quantityReceived }`.
   */
  async rateLines(id, ratings = []) {
    const { data, error } = await supabase.rpc("transmittal_rate", {
      p_transmittal_id: id,
      p_line_ratings: ratings.map((r) => ({
        line_id: r.lineId,
        rating: r.rating ?? null,
        remark: r.remark ?? null,
        in_charge_id: r.inChargeId ?? null,
        quantity_received: r.quantityReceived == null || r.quantityReceived === "" ? null : Number(r.quantityReceived),
      })),
    });
    if (error) throw error;
    return data;
  },

  /**
   * Signs a Warehouse stage (`stage` is warehouse_checking or warehouse_releasing).
   * `otherSignerId` names the other signatory from a list, or `otherSignerName`
   * types one (releasing, when no Technical stage follows). `signAsSecond`
   * signs the caller as the stage's second signatory (Inspected by) on
   * checking or Technical inspection. Sends the notices the database owes.
   * Returns the RPC result.
   */
  async completeStage(
    id,
    { stage, otherSignerId = null, otherSignerName = null, remarks = null, noPicturesReason = null, signAsSecond = false },
  ) {
    const { data, error } = await supabase.rpc("transmittal_complete_stage", {
      p_transmittal_id: id,
      p_stage: stage,
      p_other_signer_id: otherSignerId,
      p_other_signer_name: otherSignerName,
      p_remarks: remarks,
      p_no_pictures_reason: noPicturesReason,
      p_sign_as_second: !!signAsSecond,
    });
    if (error) throw error;

    const number = data.number;
    const stageName = transmittalStateLabel(data.state);
    await Promise.all([
      ...(data.notify_next_ids ?? []).map((recipient_id) =>
        notificationService.createNotification({
          recipient_id,
          type: TRANSMITTAL_NOTIFICATION.STAGE_READY,
          title: `${number} is waiting on you`,
          message: `${number} is ${lowerFirst(stageName)}.`,
          reference_id: id,
        }),
      ),
      data.notify_confirm_id
        ? notificationService.createNotification({
            recipient_id: data.notify_confirm_id,
            type: TRANSMITTAL_NOTIFICATION.CONFIRM_SIGNATURE,
            title: `Confirm your signature on ${number}`,
            message: `You are the second signatory on ${number}. Confirm or decline it.`,
            reference_id: id,
          })
        : null,
      ...(data.notify_na_ids ?? []).map((recipient_id) =>
        notificationService.createNotification({
          recipient_id,
          type: TRANSMITTAL_NOTIFICATION.NA_RAISED,
          title: `${number} has NA lines`,
          message: `${number} was checked with ${data.na_count} line${data.na_count === 1 ? "" : "s"} rated NA.`,
          reference_id: id,
        }),
      ),
    ]);
    return data;
  },

  /** The co-signer confirms (or declines) the signature stored for them on a signed stage. */
  async confirmSignature(stageId, confirm = true) {
    const { data, error } = await supabase.rpc("transmittal_confirm_signature", {
      p_stage_id: stageId,
      p_confirm: !!confirm,
    });
    if (error) throw error;

    if (data?.notify_id) {
      await notificationService.createNotification({
        recipient_id: data.notify_id,
        type: TRANSMITTAL_NOTIFICATION.SIGNATURE_DECLINED,
        title: `${data.number ?? "A Transmittal"}: signature declined`,
        message: "The co-signer declined the signature on your stage. Check it with them.",
        reference_id: data.id,
      });
    }
    return data;
  },

  /**
   * Signs one Check by slot (1 or 2) on a slip awaiting Check by. The second
   * signature closes the slip and the preparer hears of it. Returns the RPC result.
   */
  async checkBy(id, slot) {
    const { data, error } = await supabase.rpc("transmittal_check", { p_transmittal_id: id, p_slot: slot });
    if (error) throw error;

    if (data?.notify_id) {
      await notificationService.createNotification({
        recipient_id: data.notify_id,
        type: TRANSMITTAL_NOTIFICATION.CLOSED,
        title: `${data.number} is closed`,
        message: `${data.number} passed Check by and is closed.`,
        reference_id: id,
      });
    }
    return data;
  },

  /**
   * Undoes one signature, with a reason (#538): a stage (`kind` "stage" with
   * `stage`), Received in Odoo by ("odoo") or a Check by ("check_by" with
   * `slot`). The database keeps the cleared signature as history, and says who
   * was told. Returns the RPC result.
   */
  async undoSignature(id, { kind, stage = null, slot = null, reason }) {
    const why = (reason ?? "").trim();
    if (!why) throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Give a reason for undoing the signature.");
    const { data, error } = await supabase.rpc("transmittal_undo_signature", {
      p_transmittal_id: id,
      p_kind: kind,
      p_reason: why,
      p_stage: stage,
      p_slot: slot,
    });
    if (error) throw error;

    await Promise.all(
      (data?.notify_ids ?? []).map((recipient_id) =>
        notificationService.createNotification({
          recipient_id,
          type: TRANSMITTAL_NOTIFICATION.SIGNATURE_UNDONE,
          title: `${data.number}: a signature was undone`,
          message: `A signature on ${data.number} was undone: ${why}`,
          reference_id: id,
        }),
      ),
    );
    return data;
  },

  /** Records the slip's receipt into Odoo: the signer, the time and the Odoo reference (optional). */
  async receivedInOdoo(id, ref = "") {
    const { data, error } = await supabase.rpc("transmittal_received_in_odoo", {
      p_transmittal_id: id,
      p_ref: ref ?? "",
    });
    if (error) throw error;
    return data;
  },

  /**
   * Uploads a picture or video for an open stage and records it. The file is
   * checked here for size and kind; the database checks who may add it. A
   * file the database then refuses is removed again.
   */
  async attachEvidence(transmittalId, stageId, file) {
    if (!file) throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Pick a file.");
    if (file.size > PMS_EVIDENCE_MAX_BYTES) {
      throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Each file must be 50 MB or less.");
    }
    const kind = (file.type ?? "").startsWith("video/") ? "video" : (file.type ?? "").startsWith("image/") ? "picture" : null;
    if (!kind) throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "Pictures and videos only.");

    const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
    const path = `${transmittalId}/${stageId}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from(PMS_EVIDENCE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;

    const { data, error } = await supabase.rpc("transmittal_attach_evidence", {
      p_stage_id: stageId,
      p_kind: kind,
      p_path: path,
      p_file_name: file.name,
      p_mime: file.type,
      p_size: file.size,
    });
    if (error) {
      await supabase.storage.from(PMS_EVIDENCE_BUCKET).remove([path]);
      throw error;
    }
    return data;
  },

  /** Removes a picture the caller added, while its stage is open: the stored file first, then its record. */
  async removeEvidence(evidence) {
    const { error: removeError } = await supabase.storage.from(PMS_EVIDENCE_BUCKET).remove([evidence.storagePath]);
    if (removeError) throw removeError;
    const { data, error } = await supabase.rpc("transmittal_remove_evidence", { p_evidence_id: evidence.id });
    if (error) throw error;
    return data;
  },

  /** A time-limited link to a picture or video the bucket holds for a reader of the slip. */
  async evidenceUrl(storagePath, expiresIn = 3600) {
    const { data, error } = await supabase.storage.from(PMS_EVIDENCE_BUCKET).createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },

  /** Super Admins only, and only before any Transmittal exists: the first TG03 number. */
  async setFirstNumber(n) {
    const value = Number(n);
    if (!Number.isInteger(value) || value < 1) {
      throw new TransmittalError(TRANSMITTAL_ERROR.INVALID, "The first number is a whole number from 1.");
    }
    const { data, error } = await supabase.rpc("transmittal_set_first_number", { p_number: value });
    if (error && /already exists/.test(error.message ?? "")) {
      throw new TransmittalError(
        TRANSMITTAL_ERROR.INVALID,
        "TG03 numbering has already started, so the first number can't be changed.",
      );
    }
    if (error) throw error;
    return data;
  },

  /** The first Transmittal's number (e.g. "TG03-526"), or null while none exists and the first number is still open. */
  async firstNumber() {
    const { data, error } = await supabase
      .from("transmittals")
      .select("number")
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;
    return data?.[0]?.number ?? null;
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
