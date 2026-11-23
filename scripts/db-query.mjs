#!/usr/bin/env node
/**
 * Runs read-only SQL against prod, staging or the local stack and prints short
 * psql-style tables. The one way to read live data when Sean asks for it
 * (AGENTS.md, "Local-first development"); no one-off pg scripts.
 *
 * Usage:
 *   pnpm db:query prod -e "select number, state from ipas limit 5"
 *   pnpm db:query staging checks.sql       # several statements; each prints its own table
 *   pnpm db:query prod - <<'SQL'           # SQL from stdin, no file needed
 *   select ...;
 *   SQL
 *   pnpm db:query prod --describe ipas     # a table's columns; schema.table works too
 *
 * Options: --limit N (rows shown per result, default 100), --wide (no 60-character
 * cut-off), --json (one JSON object per row).
 *
 * Everything runs inside one BEGIN READ ONLY ... ROLLBACK, sent as a single
 * message, with a 60 s statement timeout. SQL that could end or switch off that
 * transaction (COMMIT, END, SET ROLE, ...) is refused before connecting.
 * Column names without a query: supabase/schema/staging.sql is kept current;
 * supabase/schema/prod.sql can lag behind prod.
 *
 * Reads PROD_DB_URL / STAGING_DB_URL from .env.local, and LOCAL_DB_URL or the
 * CLI default for local.
 */
import pg from "pg"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs"
import { formatJson, formatTable, literal, refuseReason } from "./lib/dbQuery.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const USAGE = `Usage: pnpm db:query <prod|staging|local> (-e "<sql>" | <file.sql> | - | --describe <table>) [--limit N] [--wide] [--json]`

function fail(message) {
  console.error(message)
  process.exit(1)
}

const args = process.argv.slice(2).filter((a) => a !== "--")
const target = args[0]
if (!["prod", "staging", "local"].includes(target)) fail(USAGE)

let sql = null
let describe = null
let limit = 100
let wide = false
let json = false
for (let i = 1; i < args.length; i++) {
  const arg = args[i]
  if (arg === "-e") sql = args[++i] ?? fail(USAGE)
  else if (arg === "--describe") describe = args[++i] ?? fail(USAGE)
  else if (arg === "--limit") limit = Number(args[++i])
  else if (arg === "--wide") wide = true
  else if (arg === "--json") json = true
  else if (arg === "-") sql = readFileSync(0, "utf8")
  else if (!arg.startsWith("-") && sql === null) sql = readFileSync(arg, "utf8")
  else fail(`Unknown argument: ${arg}\n${USAGE}`)
}
if (!Number.isInteger(limit) || limit < 1) fail("--limit takes a whole number above 0.")
if (describe) {
  const [schema, table] = describe.includes(".") ? describe.split(".", 2) : ["public", describe]
  sql = `select column_name, data_type, is_nullable as null_ok, column_default as default_value
    from information_schema.columns
    where table_schema = ${literal(schema)} and table_name = ${literal(table)}
    order by ordinal_position;
  select table_schema || '.' || table_name as close_names
    from information_schema.tables
    where table_name ilike ${literal(`%${table}%`)} and table_schema not in ('pg_catalog', 'information_schema')
    order by 1 limit 15`
}
if (sql === null) fail(USAGE)
const refused = refuseReason(sql)
if (refused) fail(refused)

const envVar = { prod: "PROD_DB_URL", staging: "STAGING_DB_URL", local: "LOCAL_DB_URL" }[target]
const dbUrl = loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar] ?? (target === "local" ? DEFAULT_LOCAL_DB_URL : null)
if (!dbUrl) fail(`Missing ${envVar} in .env.local.`)

// Remote databases are SSL-only; the local stack speaks plaintext.
const isLocal = /^(127\.0\.0\.1|localhost)$/.test(new URL(dbUrl).hostname)
const client = new pg.Client({ connectionString: dbUrl, ssl: isLocal ? false : { rejectUnauthorized: false } })
await client.connect()

let results
try {
  const reply = await client.query({
    // One message: the user's SQL can't run outside the read-only transaction.
    // The newlines keep a trailing -- comment from swallowing the ROLLBACK.
    text: `begin read only; set local statement_timeout = '60s';\n${sql}\n;\nrollback;`,
    rowMode: "array",
  })
  results = (Array.isArray(reply) ? reply : [reply]).slice(2, -1).filter((r) => r.command !== null)
} catch (error) {
  console.error(`ERROR: ${error.message}`)
  if (/(column|relation) .* does not exist/.test(error.message)) {
    console.error(`Look the names up with: pnpm db:query ${target} --describe <table>`)
  }
  await client.end().catch(() => {})
  process.exit(1)
}
await client.end()

console.log(`-- ${target}, read-only`)
if (describe) {
  const [columns, close] = results
  if (columns.rows.length) console.log(formatTable(columns.fields.map((f) => f.name), columns.rows, { limit: 1000, wide }))
  else {
    const names = close.rows.map((r) => r[0])
    console.log(`No table named ${describe}.${names.length ? ` Close names: ${names.join(", ")}` : ""}`)
  }
  process.exit(0)
}
results.forEach((result, i) => {
  if (results.length > 1) console.log(`${i ? "\n" : ""}-- result ${i + 1}`)
  if (!result.fields.length) return console.log(`${result.command}${result.rowCount === null ? "" : ` ${result.rowCount}`}`)
  const columns = result.fields.map((f) => f.name)
  console.log(json ? formatJson(columns, result.rows, { limit }) : formatTable(columns, result.rows, { limit, wide }))
})
