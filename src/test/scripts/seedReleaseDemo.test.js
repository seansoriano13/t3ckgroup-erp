import { describe, it, expect } from "vitest"
import { derivedId, collectUuids, remap } from "../../../scripts/lib/releaseDemo.mjs"

// The demo flow is a copy of Government whose ids are derived, not random, so
// a re-run finds the copy it made before and only adds what is missing.
describe("seed-release-demo helpers", () => {
  const a = "0626af73-b032-42bc-a914-197741523bc7"
  const b = "7a223a36-16b3-4842-a6e0-88798459b653"

  it("derives the same copy id every run, and a different one per source id", () => {
    expect(derivedId(a)).toBe(derivedId(a))
    expect(derivedId(a)).not.toBe(derivedId(b))
    expect(derivedId(a)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("finds ids anywhere, jsonb and free text included", () => {
    const found = collectUuids({ id: a, config: { members: [{ employeeId: b.toUpperCase() }] }, note: `from ${a}` })
    expect([...found].sort()).toEqual([a, b].sort())
  })

  // A person left unswapped in an Action's config would be pinged by a live click.
  it("swaps every id it knows, at any depth, and leaves the rest", () => {
    const map = new Map([[b, "demo-person"]])
    const other = "11111111-1111-4111-8111-111111111111"
    expect(remap({ members: [{ employeeId: b }], createdBy: other, title: "PB Team" }, map)).toEqual({
      members: [{ employeeId: "demo-person" }],
      createdBy: other,
      title: "PB Team",
    })
  })
})
