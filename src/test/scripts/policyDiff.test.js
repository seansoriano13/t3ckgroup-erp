import { describe, it, expect } from "vitest"
import { diffPolicies, partitionAccepted } from "../../../scripts/lib/policyDiff.mjs"

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

describe("partitionAccepted", () => {
  it("passes only the accepted system_updates leftovers", () => {
    const sys = (policyname) => row({ tablename: "system_updates", policyname })
    const d = diffPolicies(
      [sys("Enable read for authenticated users"), sys("Enable write operations for authenticated users"), row({ policyname: "x" })],
      [],
    )
    const { failing, accepted } = partitionAccepted(d)
    expect(accepted).toHaveLength(2)
    expect(failing.map((x) => x.policy)).toEqual(["t.x"])
  })
  it("still fails a changed definition on an accepted name", () => {
    const d = diffPolicies([row({ tablename: "system_updates", policyname: "Enable read for authenticated users" })], [row({ tablename: "system_updates", policyname: "Enable read for authenticated users", qual: "false" })])
    expect(partitionAccepted(d).failing).toHaveLength(1)
  })
})
