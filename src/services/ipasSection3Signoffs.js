import { supabase } from "../lib/supabase";
import { IPAS_COSTING_SECTION, IPAS_SIGNOFF_ROLE } from "../constants/ipas";
import { section3StateOf } from "../utils/ipasSignoffs";

/**
 * Where section 3 (the stored costing section) stands on each IPAS, from its live
 * sign-offs: `{ submitted: Set, approved: Set }` of IPAS ids. One read, shared by the
 * IPAS list filter and Order Monitoring, so they cannot disagree (#590). Pass `ids`
 * to read just those IPAS; leave it out for every IPAS the viewer can read.
 */
export async function readSection3Signoffs(ids) {
  let query = supabase
    .from("ipas_signoffs")
    .select("ipas_id, role")
    .eq("section", IPAS_COSTING_SECTION)
    .in("role", [IPAS_SIGNOFF_ROLE.PREPARED, IPAS_SIGNOFF_ROLE.APPROVED])
    .is("cleared_at", null);
  if (ids) query = query.in("ipas_id", ids);
  const { data, error } = await query;
  if (error) throw error;

  const rolesByIpas = new Map();
  for (const row of data ?? []) {
    const roles = rolesByIpas.get(row.ipas_id) ?? [];
    roles.push(row.role);
    rolesByIpas.set(row.ipas_id, roles);
  }
  const submitted = new Set();
  const approved = new Set();
  for (const [id, roles] of rolesByIpas) {
    const state = section3StateOf(roles);
    if (state.submitted) submitted.add(id);
    if (state.approved) approved.add(id);
  }
  return { submitted, approved };
}
