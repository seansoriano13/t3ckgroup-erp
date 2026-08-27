import { supabase } from "../lib/supabase";

/**
 * What procurement has riding on a task, for the generic task services to ask.
 *
 * This is a leaf module on purpose. The guard belongs to procurement — the
 * generic task service has no business knowing that `sor_procurement_requests`
 * exists — but `purchasingService` already imports `taskMutationService`, so
 * putting it there and importing back would close a cycle. Keeping the query
 * in a module that imports nothing but the client lets both sides depend on it
 * and neither depend on the other.
 */

/**
 * Why this task must not be deleted, or null if nothing objects.
 *
 * A requisition task is the purchasing half of a request sales raised. Deleting
 * it would strand rows that still point at it, and leave sales waiting on an
 * answer that can no longer be recorded — so the way to close one is to answer
 * every item, or to have sales withdraw the ask.
 */
export async function procurementDeletionBlock(taskId) {
  if (!taskId) return null;

  const { data: linkedRequests } = await supabase
    .from("sor_procurement_requests")
    .select("id")
    .eq("task_id", taskId);

  if (!linkedRequests?.length) return null;

  return (
    "This task is linked to procurement requests from sales. To close it, " +
    "record an outcome for each item (e.g. 'Cannot source') or ask Sales to " +
    "cancel the request from the SOR."
  );
}
