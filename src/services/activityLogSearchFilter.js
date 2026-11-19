import { supabase } from "../lib/supabase";
import { likePattern, quoteFilterValue, plainLogError } from "../lib/activityLogSearch";

/**
 * Looks up the Activity Log's text search and returns a function that adds it
 * to a query on an activity table: the entry's `content`, or the parent task's
 * text column. PostgREST cannot OR against an embedded `task.*` field, so the
 * matching task ids are found first and then ORed with `content`.
 *
 * It returns a function (not the query) because a query builder is thenable and
 * an async function would run it early.
 */
export async function activitySearchFilter({ search, taskTable, taskTextColumn }) {
  const trimmed = (search || "").trim();
  if (!trimmed) return (query) => query;
  const like = likePattern(trimmed);

  const { data: tasksMatch, error } = await supabase
    .from(taskTable)
    .select("id")
    .ilike(taskTextColumn, like)
    .limit(500);
  if (error) throw plainLogError(error);

  const ids = (tasksMatch || []).map((t) => t.id).filter(Boolean);
  if (ids.length === 0) return (query) => query.ilike("content", like);
  // PostgREST expects: task_id.in.(uuid1,uuid2,...)
  return (query) => query.or(`content.ilike.${quoteFilterValue(like)},task_id.in.(${ids.join(",")})`);
}
