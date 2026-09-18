import { describe, expect, it } from "vitest"
import { stagesReachableFrom } from "./stageGraph"

describe("stagesReachableFrom", () => {
  it("finds every Stage downstream of a straight line", () => {
    const edges = [
      { from_stage_id: "a", to_stage_id: "b" },
      { from_stage_id: "b", to_stage_id: "c" },
    ]

    expect(stagesReachableFrom("a", edges)).toEqual(new Set(["b", "c"]))
  })

  it("returns an empty set for a Stage with no outgoing moves", () => {
    const edges = [{ from_stage_id: "a", to_stage_id: "b" }]

    expect(stagesReachableFrom("b", edges)).toEqual(new Set())
  })

  it("follows a fork to every branch", () => {
    const edges = [
      { from_stage_id: "a", to_stage_id: "b" },
      { from_stage_id: "a", to_stage_id: "c" },
    ]

    expect(stagesReachableFrom("a", edges)).toEqual(new Set(["b", "c"]))
  })

  it("does not loop forever on a cycle, and includes the start Stage only if a path loops back to it", () => {
    const edges = [
      { from_stage_id: "a", to_stage_id: "b" },
      { from_stage_id: "b", to_stage_id: "c" },
      { from_stage_id: "c", to_stage_id: "a" },
    ]

    expect(stagesReachableFrom("a", edges)).toEqual(new Set(["b", "c", "a"]))
  })

  it("ignores moves that touch other Stages entirely", () => {
    const edges = [
      { from_stage_id: "a", to_stage_id: "b" },
      { from_stage_id: "x", to_stage_id: "y" },
    ]

    expect(stagesReachableFrom("a", edges)).toEqual(new Set(["b"]))
  })
})
