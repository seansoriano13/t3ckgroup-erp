import { supabase } from "../lib/supabase";
import { IPAS_REQUEST_SECTION, IPAS_SIGNOFF_ROLE } from "../constants/ipas";

// Past this many ids the sign-off read asks for every live section 1 sign-off instead:
// a long `in` list would overrun the URL, and the table is small.
const IN_LIST_LIMIT = 50;

/**
 * The two facts the IPAS Status needs that the IPAS row does not carry (#597): is
 * section 1 prepared or approved, and has the IPAS been worked on since it was
 * raised. Read for many IPAS in two cheap calls, so the list needs no per-IPAS read.
 *
 * Returns `{ section1Started: Set, workedOn: Set }` of IPAS ids. `ids` are the IPAS
 * to ask about; with none, nothing is asked.
 *
 * "Worked on" is the database's `ipas_worked_on`: any history beyond the system's own
 * entries (raised, the Odoo sync, On-Hold changes). One list, in one place.
 */
export async function readIpasStatusFacts(ids) {
  if (!ids?.length) return { section1Started: new Set(), workedOn: new Set() };
  const wanted = new Set(ids);

  let signoffQuery = supabase
    .from("ipas_signoffs")
    .select("ipas_id")
    .eq("section", IPAS_REQUEST_SECTION)
    .in("role", [IPAS_SIGNOFF_ROLE.PREPARED, IPAS_SIGNOFF_ROLE.APPROVED])
    .is("cleared_at", null);
  if (ids.length <= IN_LIST_LIMIT) signoffQuery = signoffQuery.in("ipas_id", ids);

  const [signoffs, worked] = await Promise.all([signoffQuery, supabase.rpc("ipas_worked_on", { p_ipas_ids: ids })]);
  if (signoffs.error) throw signoffs.error;
  if (worked.error) throw worked.error;

  return {
    section1Started: new Set((signoffs.data ?? []).map((row) => row.ipas_id).filter((id) => wanted.has(id))),
    workedOn: new Set((worked.data ?? []).filter((id) => wanted.has(id))),
  };
}
