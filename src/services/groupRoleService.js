import { supabase } from "../lib/supabase";

export const groupRoleService = {
  getRoles: async () => {
    const { data, error } = await supabase
      .from("committee_roles")
      .select("*")
      .order("created_at", { ascending: true });
      
    if (error) throw error;
    return data;
  },
  
  addRole: async (roleName) => {
    const { data, error } = await supabase
      .from("committee_roles")
      .insert([{ role_name: roleName }])
      .select()
      .single();
      
    if (error) throw error;
    return data;
  },
  
  updateRole: async (id, newName) => {
    const { data, error } = await supabase
      .from("committee_roles")
      .update({ role_name: newName })
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
