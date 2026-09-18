/**
 * Four questions, asked the way the application asks them.
 *
 * Row level security refuses in two different shapes and it matters which one
 * a test expects:
 *
 *   INSERT       raises. PostgREST returns 42501, "new row violates
 *                row-level security policy".
 *   SELECT       does not raise. Rows the policy excludes are simply not
 *   UPDATE       returned, so a refusal looks like an empty result. A test
 *   DELETE       that only checks `error` is null passes on a refusal.
 *
 * So every helper here reports what actually happened rather than whether an
 * error was thrown, and the matrix asserts on that.
 */

/** Can this client see the row with this id at all? */
export async function canRead(client, table, id) {
    const { data, error } = await client.from(table).select("id").eq("id", id)
    if (error) throw new Error(`Reading ${table}: ${error.message}`)
    return data.length > 0
}

/**
 * Attempt an insert. Returns `{ ok }` plus the row on success, or the Postgres
 * error code on refusal. A row that lands is deleted again by the caller, or
 * by teardown.
 */
export async function tryInsert(client, table, row) {
    const { data, error } = await client.from(table).insert(row).select("id")
    if (error) return { ok: false, code: error.code, message: error.message }
    return { ok: true, id: data?.[0]?.id ?? null }
}

/**
 * Attempt an update. `affected` is the count of rows the policy actually let
 * through — zero is a refusal, not a no-op, and that distinction is the whole
 * reason this helper exists.
 */
export async function tryUpdate(client, table, id, patch) {
    const { data, error } = await client.from(table).update(patch).eq("id", id).select("id")
    if (error) return { ok: false, affected: 0, code: error.code, message: error.message }
    return { ok: true, affected: data.length }
}

/** Attempt a delete. Same shape, same reason. */
export async function tryDelete(client, table, id) {
    const { data, error } = await client.from(table).delete().eq("id", id).select("id")
    if (error) return { ok: false, affected: 0, code: error.code, message: error.message }
    return { ok: true, affected: data.length }
}

/** The code Postgres raises when a write violates a policy. */
export const RLS_VIOLATION = "42501"
