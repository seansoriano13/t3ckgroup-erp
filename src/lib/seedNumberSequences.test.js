import { describe, expect, it } from "vitest"
import { NUMBER_SEQUENCES, numberSequenceResyncSql } from "../../scripts/lib/seedShared.mjs"

describe("seed restore number sequences", () => {
  it("covers the four document number sequences", () => {
    expect(NUMBER_SEQUENCES.map((s) => s.sequence).sort()).toEqual([
      "packing_list_number_seq",
      "purchase_request_number_seq",
      "sor_canvass_number_seq",
      "transmittal_number_seq",
    ])
  })

  it("sets each sequence to the max trailing number, uncalled when empty", () => {
    const sql = numberSequenceResyncSql(NUMBER_SEQUENCES[0])
    expect(sql).toContain("setval('public.purchase_request_number_seq'")
    expect(sql).toContain(`max(substring("pr_number" from '[0-9]+$')::bigint)`)
    expect(sql).toContain("exists (")
  })
})
