import { describe, expect, it } from "vitest"
import { schema } from "@/test/db/schema"
import { SEED_EXCLUDED_TABLES, SEED_TABLES } from "../../scripts/lib/seedShared.mjs"

/**
 * Issue #199 — the local seed copies every public table the migrations
 * build, or names why it doesn't. The fake database's schema parser reads
 * the same migrations, so its table list is the one to hold the seed to.
 */
describe("seed coverage", () => {
  const built = Object.keys(schema.tables).sort()

  it("seeds or excludes every table the migrations build, and nothing else", () => {
    const covered = [...SEED_TABLES, ...Object.keys(SEED_EXCLUDED_TABLES)].sort()
    expect(covered).toEqual(built)
  })

  it("seeds no table the migrations no longer build", () => {
    expect(SEED_TABLES.filter((t) => !built.includes(t))).toEqual([])
  })

  it("never both seeds and excludes a table, or lists one twice", () => {
    expect(SEED_TABLES.filter((t) => t in SEED_EXCLUDED_TABLES)).toEqual([])
    expect(new Set(SEED_TABLES).size).toBe(SEED_TABLES.length)
  })

  it("states a reason for every exclusion", () => {
    for (const [table, reason] of Object.entries(SEED_EXCLUDED_TABLES)) {
      expect(typeof reason === "string" && reason.trim().length > 0, table).toBe(true)
    }
  })
})
