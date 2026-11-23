import { describe, it, expect } from "vitest"
import { formatJson, formatTable, literal, refuseReason, stripSqlNoise } from "../../../scripts/lib/dbQuery.mjs"

// pnpm db:query reads prod. It wraps the SQL in one BEGIN READ ONLY ...
// ROLLBACK message; refuseReason is the belt that stops SQL ending that
// transaction early, which would let a later statement write.

describe("refuseReason", () => {
  it.each([
    "select number, state from ipas where number = 'TGIPAS_064'",
    "select case when a then 1 else 0 end from t; select 2;",
    "select begin_date, end_date from leaves", // keywords inside names
    "select 'commit; delete from x' as note", // keywords inside a string
    "-- commit later\nselect 1",
  ])("lets read SQL run: %s", (sql) => {
    expect(refuseReason(sql)).toBeNull()
  })

  it.each([
    ["select 1; commit; delete from ipas", "COMMIT"],
    ["select 1; end; update ipas set state = 'x'", "END"],
    ["ROLLBACK; delete from ipas", "ROLLBACK"],
    ["start transaction read write", "START TRANSACTION"],
  ])("refuses SQL that ends the transaction: %s", (sql, word) => {
    expect(refuseReason(sql)).toContain(word)
  })

  it.each([
    "set transaction_read_only = off",
    "set local default_transaction_read_only = off",
    "set role postgres",
    "set session characteristics as transaction read write",
  ])("refuses SQL that switches off read-only: %s", (sql) => {
    expect(refuseReason(sql)).toMatch(/refused/)
  })

  it("refuses empty SQL", () => {
    expect(refuseReason(" ; -- nothing")).toMatch(/no SQL/)
  })

  it("blanks dollar-quoted bodies", () => {
    expect(stripSqlNoise("do $$ begin commit; end $$")).not.toMatch(/commit/)
  })
})

describe("formatTable", () => {
  it("prints a psql-style table with the row count", () => {
    const out = formatTable(["number", "total"], [["TGIPAS_064", "10.5"], ["TGIPAS_062", null]])
    expect(out).toBe(
      ["number     | total", "-----------+------", "TGIPAS_064 | 10.5", "TGIPAS_062 | null", "(2 rows)"].join("\n"),
    )
  })

  it("cuts long cells and says when rows are held back", () => {
    const out = formatTable(["note"], [["x".repeat(80)], ["y"], ["z"]], { limit: 2 })
    expect(out).toContain(`${"x".repeat(59)}…`)
    expect(out).toContain("(3 rows), showing the first 2; use --limit to see more")
  })

  it("writes objects as JSON and dates as ISO", () => {
    const out = formatTable(["copy", "at"], [[{ po: { state: "purchase" } }, new Date("2026-11-23T00:00:00Z")]], { wide: true })
    expect(out).toContain('{"po":{"state":"purchase"}} | 2026-11-23T00:00:00.000Z')
  })
})

describe("formatJson and literal", () => {
  it("numbers repeated column names", () => {
    expect(formatJson(["id", "id"], [[1, 2]])).toBe('{"id":1,"id_2":2}')
  })

  it("quotes a literal safely", () => {
    expect(literal("o'neil")).toBe("'o''neil'")
  })
})
