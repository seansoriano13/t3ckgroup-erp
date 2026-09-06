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

  await client.query("SET session_replication_role = 'origin';")
  await client.end()
  console.log("\nDone. Log in locally with any restored account's email and VITE_TEST_PASSWORD.")
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`
}

// pg deserializes both a jsonb array and a native Postgres array column into
// a plain JS array — there is no way to tell them apart from the value
// alone. Every jsonb column in this schema needs re-stringifying on the way
// back in; `tasks.attachment_urls` is the one genuine `text[]` column among
// the seeded tables, and pg already knows how to send a JS array as one
// natively, so it is the one column excluded from that rule.
const NATIVE_ARRAY_COLUMNS = new Set(["attachment_urls"])

async function insertRows(client, schema, table, rows) {
  if (!rows || rows.length === 0) return
  const columns = Object.keys(rows[0])
  const columnList = columns.map(quoteIdent).join(", ")
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ")
  const insertSql = `insert into ${schema}.${quoteIdent(table)} (${columnList}) values (${placeholders})`

  for (const row of rows) {
    const values = columns.map((c) => {
      const v = row[c]
      if (v === null || typeof v !== "object") return v
      if (Array.isArray(v) && NATIVE_ARRAY_COLUMNS.has(c)) return v
      return JSON.stringify(v)
    })
    await client.query(insertSql, values)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
