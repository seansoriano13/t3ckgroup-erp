#!/usr/bin/env node
/**
 * Loads a sanitized seed dump (scripts/seed-dump.mjs) into the local
 * database, then resets every restored account's password to
 * VITE_TEST_PASSWORD so `VITE_ALLOW_TEST_LOGIN` (see src/pages/login) can log
 * in as any role. Issue #87.
 *
 * Usage:
 *   node scripts/seed-restore.mjs [path-to-dump.json]   # defaults to the
 *                                                        # staging cache
 *
 * Targets LOCAL_DB_URL, or the default `supabase start` connection string
 * when unset. Truncates local tables first — the local database is
 * disposable by design, so this never asks for confirmation.
 */
import pg from "pg"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const DEFAULT_TEST_PASSWORD = "password123"

async function main() {
  const env = loadDotEnvLocal(repoRoot)
  const dbUrl = process.env.LOCAL_DB_URL ?? env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL
  const testPassword = env.VITE_TEST_PASSWORD || DEFAULT_TEST_PASSWORD
  const dumpPath = process.argv[2] ?? join(repoRoot, "supabase", ".seed", "staging-dump.json")

  let dump
  try {
    dump = JSON.parse(readFileSync(dumpPath, "utf8"))
  } catch {
    console.error(`Could not read ${dumpPath}. Run 'pnpm db:seed:dump' first (or pass a snapshot file).`)
    process.exit(1)
  }

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()
  await client.query("SET session_replication_role = 'replica';")

  const tableNames = Object.keys(dump.tables)

  console.log("Clearing local tables...")
  for (const table of [...tableNames].reverse()) {
    await client.query(`truncate table public.${quoteIdent(table)} cascade`).catch(() => {})
  }
  await client.query("truncate table auth.users cascade").catch(() => {})

  console.log("Restoring auth.users...")
  await insertRows(client, "auth", "users", dump.authUsers)

  for (const table of tableNames) {
    const rows = dump.tables[table]
    process.stdout.write(`- [${table}]... `)
    await insertRows(client, "public", table, rows)
    console.log(`${rows.length} rows`)
  }

  if (dump.authUsers.length > 0) {
    console.log(`Resetting every restored password to VITE_TEST_PASSWORD...`)
    await client.query("update auth.users set encrypted_password = crypt($1, gen_salt('bf'))", [testPassword])
  }

  console.log("Resyncing identity sequences...")
  await resyncSequences(client, tableNames)

  await client.query("SET session_replication_role = 'origin';")
  await client.end()
  console.log("\nDone. Log in locally with any restored account's email and VITE_TEST_PASSWORD.")
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`
}

// `overriding system value` above inserts the dump's own serial_no/id-style
// identity values, but never advances the identity sequence behind them —
// Postgres only auto-advances a sequence when it generates the value itself.
// Left alone, the next INSERT to rely on the default (e.g. registering a new
// SOR) collides with a seeded row's serial_no (23505 unique_violation).
// Every identity column gets resynced to its restored table's current max.
async function resyncSequences(client, tableNames) {
  // IPAS numbers come from a plain sequence, not an identity column: carry it
  // past the restored rows (the sheet's last number is 048, so never below it).
  if (tableNames.includes("ipas")) {
    await client.query(
      `select setval('public.ipas_number_seq',
         greatest(48, coalesce((select max(substring(number from '[0-9]+$')::int) from public.ipas), 0)))`,
    )
  }
  for (const table of tableNames) {
    const { rows: identityColumns } = await client.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 and is_identity = 'YES'`,
      [table],
    )
    for (const { column_name: column } of identityColumns) {
      await client.query(
        `select setval(pg_get_serial_sequence('public.${quoteIdent(table)}', $1),
           coalesce((select max(${quoteIdent(column)}) from public.${quoteIdent(table)}), 1))`,
        [column],
      )
    }
  }
}

async function insertRows(client, schema, table, rows) {
  if (!rows || rows.length === 0) return
  // A generated column (auth.users.confirmed_at, computed from
  // email/phone_confirmed_at by GoTrue's own migrations) rejects an
  // explicit value outright — Postgres recomputes it from the columns it
  // depends on, which are themselves being restored in this same insert.
  const { rows: schemaColumns } = await client.query(
    "select column_name, is_generated, data_type from information_schema.columns where table_schema = $1 and table_name = $2",
    [schema, table],
  )
  const generatedColumns = new Set(
    schemaColumns.filter((r) => r.is_generated === "ALWAYS").map((r) => r.column_name),
  )
  // pg deserializes a jsonb column straight into the equivalent JS value —
  // an object, an array, but also a bare string/number/boolean when that's
  // all the column holds (e.g. a text-type Stage Field's saved value comes
  // back as the plain JS string "TEst", not {value: "TEst"}). Every jsonb/
  // json column needs re-stringifying on the way back in regardless of the
  // value's shape — guessing from `typeof v === "object"` misses that
  // scalar case and sends an unquoted string where Postgres expects a JSON
  // literal. Driven by the column's actual type, not the value, so a real
  // `text[]` column (`tasks.attachment_urls`, `employees.hidden_nav_keys`,
  // `app_settings.retail_storefronts`) is left alone and pg sends the JS
  // array natively.
  const jsonColumns = new Set(
    schemaColumns.filter((r) => r.data_type === "json" || r.data_type === "jsonb").map((r) => r.column_name),
  )
  // A dump taken from an environment whose schema is ahead of (or behind) the
  // local one can carry columns this table no longer has — e.g. staging still
  // holds app_settings columns that a local migration has since dropped. Keep
  // only columns that actually exist in the target table.
  const liveColumns = new Set(schemaColumns.map((r) => r.column_name))
  const columns = Object.keys(rows[0]).filter(
    (c) => liveColumns.has(c) && !generatedColumns.has(c),
  )
  if (columns.length === 0) return
  const columnList = columns.map(quoteIdent).join(", ")

  // Batch insert into chunks to avoid thousands of individual sequential queries.
  // PostgreSQL maximum parameter count is 65,535.
  const maxParams = 65000
  const batchSize = Math.max(1, Math.min(500, Math.floor(maxParams / columns.length)))

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const valuePlaceholders = []
    const values = []
    let paramIndex = 1

    for (const row of chunk) {
      const rowPlaceholders = []
      for (const c of columns) {
        rowPlaceholders.push(`$${paramIndex++}`)
        const v = row[c]
        if (v === null) {
          values.push(null)
        } else if (jsonColumns.has(c)) {
          values.push(JSON.stringify(v))
        } else {
          values.push(v)
        }
      }
      valuePlaceholders.push(`(${rowPlaceholders.join(", ")})`)
    }

    const insertSql = `insert into ${schema}.${quoteIdent(table)} (${columnList}) overriding system value values ${valuePlaceholders.join(", ")}`
    await client.query(insertSql, values)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
