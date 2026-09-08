/**
 * Connection details for the local Supabase stack, and the two ways this tier
 * reaches it.
 *
 * Two clients, deliberately different:
 *
 *   serviceClient()  bypasses RLS. Seeding and teardown only. If an assertion
 *                    ever runs through this, it proves nothing.
 *   clientFor(key)   an ordinary anon-key client holding a real signed-in
 *                    user's token. Every assertion goes through one of these,
 *                    because that is the path the application takes.
 *
 * `sql` is a pg pool for the handful of questions PostgREST cannot answer —
 * whether a table has RLS enabled at all, and what its policies are.
 *
 * **Everything below is hard-coded to the local stack on purpose.** These are
 * the fixed keys and ports the Supabase CLI issues for every local install
 * (they match supabase/config.toml); they are not secrets and they cannot
 * address a remote project. There is deliberately no environment-variable
 * override: this tier runs `delete from public.employees`, and AGENTS.md
 * permits exactly two routes to a remote database — `STAGING_DB_URL` and
 * `PROD_DB_URL`, for the two scripts that already use them. Adding a third
 * that a destructive test suite reads would be how a stray export one day
 * truncates the wrong thing.
 */
import { createClient } from "@supabase/supabase-js"
import pg from "pg"

export const API_URL = "http://127.0.0.1:54321"
export const DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

/** Superuser connection, used only to install the realtime shim below. */
const ADMIN_DB_URL = "postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres"

export const ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"

const SERVICE_ROLE_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"

let _service = null

/** Service-role client. Bypasses RLS. Seeding and teardown only. */
export function serviceClient() {
    if (!_service) {
        _service = createClient(API_URL, SERVICE_ROLE_KEY, {
            auth: { autoRefreshToken: false, persistSession: false },
        })
    }
    return _service
}

let _pool = null

/** Direct SQL, for questions PostgREST cannot answer. Never for assertions. */
export function sql() {
    if (!_pool) _pool = new pg.Pool({ connectionString: DB_URL, max: 4 })
    return _pool
}

export async function closeSql() {
    if (_pool) {
        await _pool.end()
        _pool = null
    }
}

/**
 * Fails loudly and early if the stack is not up, rather than letting every
 * test fail with an opaque fetch error.
 */
export async function assertStackReachable() {
    try {
        const { rows } = await sql().query("select 1 as ok")
        if (rows[0].ok !== 1) throw new Error("unexpected response")
    } catch (cause) {
        throw new Error(
            `Cannot reach the local Supabase database at ${DB_URL}.\n` +
                `Start it with:  npx supabase start\n` +
                `Original error: ${cause.message}`,
        )
    }
}

/**
 * Makes `realtime.send` exist as a no-op, but only where it is missing.
 *
 * `tasks` carries `tasks_broadcast_change_trigger`, which calls
 * `realtime.send(...)` on every insert, update and delete. The local stack
 * disables realtime on purpose (supabase/config.toml explains why: the CLI's
 * realtime image ships a broken libapparmor and takes the whole stack down),
 * and with it disabled the `realtime` schema is present but empty.
 *
 * The consequence is not confined to this tier: **no task can be written
 * against a local stack at all** — `pnpm dev` cannot log one either. The shim
 * makes the trigger inert so the tier can seed a task and assert who may read
 * it, which is the thing under test.
 *
 * It is created only when the function is absent, so a stack that does have
 * realtime keeps the real implementation and the broadcast behaviour is
 * observed rather than silenced. It touches the disposable local database
 * only, never a migration, and it is not a fix for the underlying problem.
 */
export async function ensureRealtimeShim() {
    const { rows } = await sql().query(
        `select 1 from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'realtime' and p.proname = 'send'`,
    )
    if (rows.length) return false

    // The `realtime` schema is owned by supabase_admin, so this is the one
    // place the tier connects as that role — one short-lived connection.
    const client = new pg.Client({ connectionString: ADMIN_DB_URL })
    await client.connect()
    try {
        await client.query(`
            create or replace function realtime.send(
                payload jsonb, event text, topic text, private boolean default true
            ) returns void language plpgsql as $$
            begin
                -- Local stack runs without realtime; broadcasting is a no-op.
                return;
            end;
            $$;
            grant usage on schema realtime to authenticated, anon, service_role, postgres;
            grant execute on function realtime.send(jsonb, text, text, boolean)
                to authenticated, anon, service_role, postgres;
        `)
    } finally {
        await client.end()
    }
    return true
}

/** Whether a table has row level security turned on, and how many policies it has. */
export async function rlsStatus(table) {
    const { rows } = await sql().query(
        `select c.relrowsecurity as enabled,
                (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = $1`,
        [table],
    )
    if (!rows.length) throw new Error(`No such table: public.${table}`)
    return rows[0]
}
