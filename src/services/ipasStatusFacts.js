import { supabase } from "../lib/supabase";
import { IPAS_COSTING_SECTION, IPAS_REQUEST_SECTION, IPAS_SIGNOFF_ROLE } from "../constants/ipas";
import { section3StateOf } from "../utils/ipasSignoffs";

// Past this many ids the sign-off read asks for every live section 1 and 3 sign-off
// instead: a long `in` list would overrun the URL, and the table is small.
const IN_LIST_LIMIT = 50;

/**
 * Which of these IPAS have been worked on since they were raised (#597): the
 * database's `ipas_worked_on`, which reads a saved mark per IPAS (#928). A Set of ids.
 */
export async function readWorkedOn(ids) {
  if (!ids?.length) return new Set();
  const wanted = new Set(ids);
  const { data, error } = await supabase.rpc("ipas_worked_on", { p_ipas_ids: ids });
  if (error) throw error;
  return new Set((data ?? []).filter((id) => wanted.has(id)));
}

/**
 * The facts the IPAS Status and the list filter need that the IPAS row does not
 * carry: is section 1 prepared or approved (#597), is section 3 approved (#586), and
 * has the IPAS been worked on since it was raised. Read for many IPAS in two calls
 * made side by side, so the list needs no per-IPAS read (#928).
 *
 * Returns `{ section1Started, section3Approved, workedOn }`, each a Set of IPAS ids.
 * `ids` are the IPAS to ask about; with none, nothing is asked.
 */
export async function readIpasStatusFacts(ids) {
  if (!ids?.length) return { section1Started: new Set(), section3Approved: new Set(), workedOn: new Set() };
  const wanted = new Set(ids);

  let signoffQuery = supabase
    .from("ipas_signoffs")
    .select("ipas_id, section, role")
    .in("section", [IPAS_REQUEST_SECTION, IPAS_COSTING_SECTION])
    .in("role", [IPAS_SIGNOFF_ROLE.PREPARED, IPAS_SIGNOFF_ROLE.APPROVED])
    .is("cleared_at", null);
  if (ids.length <= IN_LIST_LIMIT) signoffQuery = signoffQuery.in("ipas_id", ids);

  const [signoffs, workedOn] = await Promise.all([signoffQuery, readWorkedOn(ids)]);
  if (signoffs.error) throw signoffs.error;

  const section1Started = new Set();
  const section3Roles = new Map();
  for (const row of signoffs.data ?? []) {
    if (!wanted.has(row.ipas_id)) continue;
    if (Number(row.section) === IPAS_REQUEST_SECTION) section1Started.add(row.ipas_id);
    else {
      const roles = section3Roles.get(row.ipas_id) ?? [];
      roles.push(row.role);
      section3Roles.set(row.ipas_id, roles);
    }
  }
  const section3Approved = new Set([...section3Roles].filter(([, roles]) => section3StateOf(roles).approved).map(([id]) => id));

  return { section1Started, section3Approved, workedOn };
}
