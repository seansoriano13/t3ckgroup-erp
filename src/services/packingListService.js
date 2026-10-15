import { supabase } from "../lib/supabase";

const PACKING_LIST_SELECT =
  "*, creator:employees!packing_lists_created_by_fkey(id, name)," +
  " packer:employees!packing_lists_packed_by_fkey(id, name, sub_department)," +
  " sor:sales_opportunities!packing_lists_opportunity_id_fkey(id, sales_reference, project_title, client_name)," +
  " boxes:packing_list_boxes(*, contents:packing_list_contents(*))";

const PACKING_LIST_LIST_SELECT =
  "id, number, state, odoo_delivery_ref, created_at, packed_at, opportunity_id," +
  " sor:sales_opportunities!packing_lists_opportunity_id_fkey(id, sales_reference, project_title)," +
  " boxes:packing_list_boxes(id)";

/**
 * Fills each row's `sor` from `packing_list_sor_refs` where the embedded SOR
 * read came back empty: the Warehouse and Purchasing read a Packing List
 * without always reading its SOR, but the list still names it.
 */
async function withSorRefs(rows) {
  const missing = rows.filter((row) => !row.sor).map((row) => row.id);
  if (missing.length === 0) return rows;
  const { data, error } = await supabase.rpc("packing_list_sor_refs", { p_packing_list_ids: missing });
  if (error) throw error;
  const refs = new Map((data ?? []).map((ref) => [ref.packing_list_id, ref]));
  return rows.map((row) => {
    const ref = refs.get(row.id);
    if (row.sor || !ref) return row;
    return {
      ...row,
      sor: { id: ref.sor_id, sales_reference: ref.sor_reference, project_title: ref.sor_project, client_name: ref.client_name },
    };
  });
}

/**
 * Packing Lists (#255, spec #251): the boxes the Warehouse packs for one SOR.
 * Every change is an RPC; the database decides who may make it, refuses a
 * packed list (the service role included) and writes the history row. Nothing
 * here touches stock or Odoo.
 */
export const packingListService = {
  /**
   * Makes a draft for one SOR. `odooDeliveryRef` is optional and typed (e.g.
   * "TG En/OUT/03390"). Returns `{ id, number }`.
   */
  async create({ opportunityId, odooDeliveryRef = null }) {
    const { data, error } = await supabase.rpc("packing_list_create", {
      p_opportunity_id: opportunityId,
      p_odoo_delivery_ref: odooDeliveryRef,
    });
    if (error) throw error;
    return data;
  },

  /** Sets or clears the typed Odoo delivery reference on a draft. */
  async updateHeader(id, { odooDeliveryRef = null }) {
    const { error } = await supabase.rpc("packing_list_update_header", {
      p_packing_list_id: id,
      p_odoo_delivery_ref: odooDeliveryRef,
    });
    if (error) throw error;
  },

  /** One Packing List with its boxes and contents, shaped for the page. Null when not visible. */
  async get(id) {
    const { data, error } = await supabase
      .from("packing_lists")
      .select(PACKING_LIST_SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [row] = await withSorRefs([data]);
    return shapePackingList(row);
  },

  /**
   * The list: `{ sorId, state }`. `sorId` narrows to one SOR; `state` is
   * "draft", "packed" or null for both. Newest first. The database returns only
   * what the caller may read.
   */
  async list({ sorId = null, state = null } = {}) {
    let query = supabase.from("packing_lists").select(PACKING_LIST_LIST_SELECT).order("created_at", { ascending: false });
    if (sorId) query = query.eq("opportunity_id", sorId);
    if (state) query = query.eq("state", state);
    const { data, error } = await query;
    if (error) throw error;
    return (await withSorRefs(data ?? [])).map((row) => ({
      id: row.id,
      number: row.number,
      state: row.state,
      odooDeliveryRef: row.odoo_delivery_ref ?? null,
      sorId: row.opportunity_id,
      sorReference: row.sor?.sales_reference ?? null,
      projectTitle: row.sor?.project_title ?? null,
      boxCount: (row.boxes ?? []).length,
      createdAt: row.created_at,
      packedAt: row.packed_at ?? null,
    }));
  },

  /** Adds a box, numbered next in the list. Returns `{ id, box_no }`. */
  async addBox(packingListId, { marks = null, sealNo = null, grossWeightKg = null } = {}) {
    const { data, error } = await supabase.rpc("packing_list_add_box", {
      p_packing_list_id: packingListId,
      p_marks: marks,
      p_seal_no: sealNo,
      p_gross_weight_kg: grossWeightKg,
    });
    if (error) throw error;
    return data;
  },

  /** Changes a box's marks, seal number and gross weight. */
  async updateBox(boxId, { marks = null, sealNo = null, grossWeightKg = null } = {}) {
    const { error } = await supabase.rpc("packing_list_update_box", {
      p_box_id: boxId,
      p_marks: marks,
      p_seal_no: sealNo,
      p_gross_weight_kg: grossWeightKg,
    });
    if (error) throw error;
  },

  /** Removes a box and its contents from a draft. */
  async removeBox(boxId) {
    const { error } = await supabase.rpc("packing_list_remove_box", { p_box_id: boxId });
    if (error) throw error;
  },

  /**
   * Replaces a box's contents. Each content is `{ description, quantity, unit,
   * snapshot }`; `snapshot` is `sorLineSnapshot(line)` for a line picked from
   * the SOR's Product List, and null for a typed line.
   */
  async setContents(boxId, contents = []) {
    const payload = contents.map((c) => ({
      description: c.description,
      quantity: c.quantity,
      unit: c.unit ?? null,
      snapshot: c.snapshot ?? null,
    }));
    const { error } = await supabase.rpc("packing_list_set_contents", {
      p_box_id: boxId,
      p_contents: payload,
    });
    if (error) throw error;
  },

  /** Signs Packed by and closes the list. Refused with no box, or a box with no contents. */
  async pack(id) {
    const { data, error } = await supabase.rpc("packing_list_pack", { p_packing_list_id: id });
    if (error) throw error;
    return data;
  },
};

/** The copy of a SOR Product List line a content keeps: name, quantity and unit at pick time. */
export function sorLineSnapshot(line) {
  return {
    name: line.product_name ?? line.name ?? "",
    quantity: Number(line.quantity) || 0,
    unit: line.unit ?? null,
  };
}

/** Shapes a packing_lists row (with its boxes and contents) for the page. */
export function shapePackingList(row) {
  return {
    id: row.id,
    number: row.number,
    state: row.state,
    odooDeliveryRef: row.odoo_delivery_ref ?? null,
    sorId: row.opportunity_id,
    sorReference: row.sor?.sales_reference ?? null,
    projectTitle: row.sor?.project_title ?? null,
    customerName: row.sor?.client_name ?? null,
    creatorName: row.creator?.name ?? null,
    createdById: row.created_by,
    packerName: row.packer?.name ?? null,
    packerDepartment: row.packer?.sub_department ?? null,
    packedAt: row.packed_at ?? null,
    signatureDeclined: Boolean(row.signature_declined),
    boxes: [...(row.boxes ?? [])]
      .sort((a, b) => a.box_no - b.box_no)
      .map((box) => ({
        id: box.id,
        boxNo: box.box_no,
        marks: box.marks ?? null,
        sealNo: box.seal_no ?? null,
        grossWeightKg: box.gross_weight_kg == null ? null : Number(box.gross_weight_kg),
        contents: [...(box.contents ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((c) => ({
            id: c.id,
            description: c.description,
            quantity: Number(c.quantity),
            unit: c.unit ?? null,
            snapshot: c.sor_line_snapshot ?? null,
          })),
      })),
  };
}
