/**
 * Cutover gate: compares the body of every public function between production and staging.
 * Prints nothing and exits 0 when they match (bar ACCEPTED, noted on stderr); lists each other
 * difference and exits 1 otherwise. Read-only.
 *
 * Why: a migration can be in prod's ledger without having run. On 2026-11-16 prod's ledger held
 * 20261104120000 for group_task_reopen (applied before it was renumbered), so the status-words
 * migration with that version never ran there, and neither the ledger check nor the policy diff
 * could see it. Function bodies show it.
 *
 * Line endings, trailing spaces, blank lines and whole-line `--` comments are ignored.
 *
 * Usage: pnpm db:function-diff
 * Reads PROD_DB_URL and STAGING_DB_URL from .env.local or the environment (the cutover rehearsal
 * points PROD_DB_URL at its local copy of prod).
 */
import pg from "pg"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

// Differences that are known and fine.
const ACCEPTED = new Set([
  // Prod-only event trigger that switches RLS on for new tables (see _archive/0000_baseline_schema.sql).
  "only on production: rls_auto_enable()",
])

const FUNCTIONS_SQL = `
  select p.oid::regprocedure::text as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')`

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const env = loadDotEnvLocal(repoRoot)

export function normalize(def) {
  return def
    .split("\r").join("")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l !== "" && !l.trimStart().startsWith("--"))
    .join("\n")
}

async function functions(envVar) {
  const url = env[envVar] ?? process.env[envVar]
  if (!url) {
    console.error(`Missing ${envVar}. Set it in .env.local or the environment.`)
    process.exit(2)
  }
  const isLocal = /@(127.0.0.1|localhost)[:/]/.test(url)
  const client = new pg.Client({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query("begin transaction read only")
    const { rows } = await client.query(FUNCTIONS_SQL)
    return new Map(rows.map((r) => [r.sig, normalize(r.def)]))
  } finally {
    await client.query("rollback").catch(() => {})
    await client.end()
  }
}

const prod = await functions("PROD_DB_URL")
const staging = await functions("STAGING_DB_URL")

const found = []
for (const [sig, def] of prod) {
  if (!staging.has(sig)) found.push({ kind: "only on production", sig })
  else if (staging.get(sig) !== def) found.push({ kind: "differs", sig, prod: def, staging: staging.get(sig) })
}
for (const sig of staging.keys()) if (!prod.has(sig)) found.push({ kind: "only on staging", sig })

let failing = 0
for (const d of found) {
  const label = `${d.kind}: ${d.sig}`
  if (ACCEPTED.has(label)) {
    console.error(`accepted: ${label}`)
    continue
  }
  failing++
  console.log(label)
  if (d.kind === "differs") {
    const a = d.prod.split("\n"), b = d.staging.split("\n")
    const inB = new Set(b), inA = new Set(a)
    for (const l of a) if (!inB.has(l)) console.log(`  prod:    ${l.trim()}`)
    for (const l of b) if (!inA.has(l)) console.log(`  staging: ${l.trim()}`)
  }
}
process.exit(failing ? 1 : 0)
