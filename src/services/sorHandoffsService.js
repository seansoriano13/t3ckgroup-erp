import { supabase } from "../lib/supabase";
import { TRANSMITTAL_PRIORITY_LABELS } from "../constants/transmittals";
import { transmittalStateLabel } from "../utils/transmittals";

/** A Packing List's state, as the SOR shows it. */
const PACKING_STATE_LABELS = { draft: "Draft", packed: "Packed" };

/**
 * The Transmittals and Packing Lists naming an SOR (#257), as summaries. The
 * database returns nothing to a caller who cannot read the SOR, and never a
 * remark, file or evidence path.
 */
export const sorHandoffsService = {
  async forSor(opportunityId) {
    if (!opportunityId) return { transmittals: [], packingLists: [] };
    const { data, error } = await supabase.rpc("handoffs_for_sor", { p_opportunity_id: opportunityId });
    if (error) throw error;
    return {
      transmittals: (data?.transmittals ?? []).map((row) => ({
        id: row.id,
        number: row.number,
        preparedOn: row.prepared_on,
        priority: row.priority,
        priorityLabel: TRANSMITTAL_PRIORITY_LABELS[row.priority] ?? row.priority,
        state: row.state,
        stateLabel: transmittalStateLabel(row.state),
        naCount: row.na_count ?? 0,
        canOpen: Boolean(row.can_open),
      })),
      packingLists: (data?.packing_lists ?? []).map((row) => ({
        id: row.id,
        number: row.number,
        state: row.state,
        stateLabel: PACKING_STATE_LABELS[row.state] ?? row.state,
        boxCount: row.box_count ?? 0,
        odooDeliveryRef: row.odoo_delivery_ref ?? null,
        canOpen: Boolean(row.can_open),
      })),
    };
  },
};
