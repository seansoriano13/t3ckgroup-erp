import { describe, it, expect } from "vitest"
import { diffPolicies } from "../../../scripts/lib/policyDiff.mjs"

const row = (o = {}) => ({ tablename: "t", policyname: "p", cmd: "SELECT", permissive: "PERMISSIVE", roles: "{authenticated}", qual: "true", with_check: "", ...o })

describe("diffPolicies", () => {
  it("is empty when the sets match, ignoring whitespace", () => {
    expect(diffPolicies([row()], [row({ qual: " true " })])).toEqual([])
  })
  it("lists a differing definition", () => {
    const d = diffPolicies([row()], [row({ qual: "false" })])
    expect(d).toMatchObject([{ policy: "t.p", kind: "differs" }])
  })
  it("lists one-sided rows", () => {
    const d = diffPolicies([row({ policyname: "a" })], [row({ policyname: "b" })])
    expect(d.map((x) => [x.policy, x.kind])).toEqual([["t.a", "only on production"], ["t.b", "only on staging"]])
  })
})
