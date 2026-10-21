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
    const start = new RegExp(`^create or replace function public\.${prefix}`, "gm")
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
