import { readFileSync } from "node:fs"

/**
 * The `create or replace function public.<prefix>...` statements of a migration, and nothing
 * else. Some policy files replay an older migration to prove it re-runs, which puts that
 * migration's functions back; they then put the latest costing functions back from the
 * refusal-codes migration. Replaying the whole file would also put back every IPAS function as
 * it stood on 2026-10-23 and silently undo every later migration for the files that run after.
 */
export function functionStatements(file, prefix) {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
    const chunks = []
    const start = new RegExp(`^create or replace function public\\.${prefix}`, "gm")
    let match
    while ((match = start.exec(text))) {
        const end = text.indexOf("\n$$;", match.index)
        if (end === -1) throw new Error(`${file}: no end for the function at offset ${match.index}`)
        chunks.push(text.slice(match.index, end + 4))
    }
    return chunks
}

/** Replays only the `costing_` functions of a migration. */
export async function replayCostingFunctions(sql, file) {
    for (const statement of functionStatements(file, "costing_")) await sql.query(statement)
}

/**
 * Takes the `costing_` functions exactly as the database has them now and returns a function that
 * puts them back. A test that replays an old migration to prove it re-runs overwrites whatever
 * later migrations did to the same functions; restoring from a snapshot needs no list of the
 * migrations that came after, so a new migration never breaks the files that run after it.
 */
export async function snapshotCostingFunctions(sql) {
    const { rows } = await sql.query(
        `select pg_get_functiondef(p.oid) as def
           from pg_proc p
          where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname like 'costing\_%'`,
    )
    return async () => {
        for (const { def } of rows) await sql.query(def)
    }
}
