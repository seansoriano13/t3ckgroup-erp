import { supabase } from "../lib/supabase";
import { cleanChecklistForSave, hasChecklistContent } from "../utils/checklist";

/**
 * The checklist a member should start with after a role is picked: the role's
 * default, but only when the member has nothing yet. Items come back unticked.
 * Never overwrites what the member already has.
 */
export function checklistForRole(role, currentChecklist) {
  if (hasChecklistContent(currentChecklist)) return currentChecklist;
  return cleanChecklistForSave(role?.default_checklist, { resetChecked: true });
}

export const groupRoleService = {
  getRoles: async () => {
    const { data, error } = await supabase
      .from("committee_roles")
      .select("*")
      .order("created_at", { ascending: true });
      
    if (error) throw error;
    return data;
  },
  
  addRole: async (roleName, defaultChecklist = null) => {
    const { data, error } = await supabase
      .from("committee_roles")
      .insert([{ role_name: roleName, default_checklist: cleanChecklistForSave(defaultChecklist, { resetChecked: true }) }])
      .select()
      .single();
      
    if (error) throw error;
    return data;
  },
  
  updateRole: async (id, newName, defaultChecklist) => {
    const patch = { role_name: newName };
    // Left out means "keep what the role has"; null or empty clears it.
    if (defaultChecklist !== undefined) {
      patch.default_checklist = cleanChecklistForSave(defaultChecklist, { resetChecked: true });
    }
    const { data, error } = await supabase
      .from("committee_roles")
      .update(patch)
      .eq("id", id)
      .select()
      .single();
      
    if (error) throw error;
    return data;
  },
  
  deleteRole: async (id) => {
    const { error } = await supabase
      .from("committee_roles")
      .delete()
      .eq("id", id);
      
    if (error) throw error;
    return true;
  }
};
