#!/usr/bin/env node
/**
 * Saves the local database's current data to a timestamped file before a
 * deliberate `supabase db reset`, so a working dataset survives the rebuild.
 * Issue #87. Pass the resulting file to scripts/seed-restore.mjs to bring it
 * back: `node scripts/seed-restore.mjs supabase/.seed/local-snapshot-<ts>.json`.
 *
 * Targets LOCAL_DB_URL, or the default `supabase start` connection string
 * when unset.
 */
import pg from "pg"
import { writeFileSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { SEED_TABLES, DEFAULT_LOCAL_DB_URL } from "./lib/seedShared.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")

async function main() {
  const dbUrl = process.env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL
  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  const dump = { dumpedAt: new Date().toISOString(), authUsers: [], tables: {} }

  const { rows: authUsers } = await client.query("select * from auth.users")
  dump.authUsers = authUsers

  for (const table of SEED_TABLES) {
    try {
      const { rows } = await client.query(`select * from public."${table}"`)
      dump.tables[table] = rows
    } catch {
      // Table doesn't exist locally yet — skip rather than fail the snapshot.
    }
  }

  await client.end()

  const cacheDir = join(repoRoot, "supabase", ".seed")
  mkdirSync(cacheDir, { recursive: true })
  const stamp = dump.dumpedAt.replace(/[:.]/g, "-")
  const outFile = join(cacheDir, `local-snapshot-${stamp}.json`)
  writeFileSync(outFile, JSON.stringify(dump, null, 2))
  console.log(`Wrote ${outFile}`)
  console.log(`Restore it later with: node scripts/seed-restore.mjs ${outFile}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
