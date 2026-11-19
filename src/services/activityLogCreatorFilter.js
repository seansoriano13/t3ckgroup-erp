import { supabase } from "../lib/supabase";

/**
 * Employee ids whose department (and sub-department) match the Activity Log's
 * Department / Sub-department filters, or null when neither is set. The log
 * filters parent tasks by "created by one of these", so the department filter
 * runs on the server and paging follows it.
 *
 * The ids go into one `in.(...)` filter. That is fine here: a department is a few
 * dozen people, so the list stays far below the URL size limit.
 */
export async function creatorIdsForDepartment({ dept = "ALL", subDept = "ALL" } = {}) {
  const hasDept = dept && dept !== "ALL";
  const hasSub = subDept && subDept !== "ALL";
  if (!hasDept && !hasSub) return null;

  let query = supabase.from("employees").select("id");
  if (hasDept) query = query.eq("department", dept);
  if (hasSub) query = query.eq("sub_department", subDept);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((e) => e.id);
}
