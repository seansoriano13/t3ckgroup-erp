import { describe, it, expect, afterAll } from "vitest"
import { sql, closeSql } from "./support/stack.js"
import { DEMO_LISTS } from "../../../scripts/lib/demoActions.mjs"

// The demo reset (scripts/demo-purchasing-setup.mjs) refills every signer list from
// DEMO_LISTS in one transaction, so a single key the database no longer allows aborts
// the whole reset. #908 retired team_rrd/team_ioe and the reset broke on staging for
// exactly that reason. Each list key must pass its table's key check.

afterAll(closeSql)

async function allowedKeys(table) {
  const { rows } = await sql().query(
    `select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1`,
    [`${table}_key_chk`],
  )
  if (!rows[0]) return null
  return [...rows[0].def.matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe("demo reset signer lists", () => {
  for (const [table, lists] of Object.entries(DEMO_LISTS)) {
    it(`${table} uses only keys the database allows`, async () => {
      const allowed = await allowedKeys(table)
      if (allowed === null) return // no key check on this table
      expect(Object.keys(lists).filter((k) => !allowed.includes(k))).toEqual([])
    })
  }
})
