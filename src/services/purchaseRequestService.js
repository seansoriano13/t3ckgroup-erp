import { supabase } from "../lib/supabase";

/**
 * Purchase Request members (issue #304). Both writes are RPCs: the database
 * decides who may (a purchasing member or a Super Admin) and what a new
 * member's side and window are.
 */
export const purchaseRequestService = {
  async addMember(requestId, employeeId) {
    const { error } = await supabase.rpc("purchase_request_add_member", {
      p_request_id: requestId,
      p_employee_id: employeeId,
    });
    if (error) throw error;
  },

  async removeMember(requestId, employeeId) {
    const { error } = await supabase.rpc("purchase_request_remove_member", {
      p_request_id: requestId,
      p_employee_id: employeeId,
    });
    if (error) throw error;
  },
};
