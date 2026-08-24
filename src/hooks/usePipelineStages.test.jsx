import { describe, expect, it } from "vitest"
import { waitFor } from "@testing-library/react"
import { renderHookWithQuery } from "@/test/support"
import { usePipelineStages } from "./usePipelineStages"
import { makePipelineStage } from "@/test/factories"

/**
 * Everything in the Sales module renders the pipeline as structure — board
 * columns, a filter, a stepper — so this hook never hands back an empty list.
 */
describe("usePipelineStages", () => {
  it("serves the policy pipeline on the first paint, before the query resolves", () => {
    const { result } = renderHookWithQuery(() => usePipelineStages())

    // No await: this is what the board paints with.
    expect(result.current.stages.map((s) => s.code)).toContain("LEAD")
    expect(result.current.stages.map((s) => s.code)).toContain("AWARDED")
  })

  it("replaces the seed with the configured pipeline once loaded", async () => {
    makePipelineStage({ code: "FIRST", label: "First", sort_order: 10 })
    makePipelineStage({ code: "SECOND", label: "Second", sort_order: 20 })

    const { result } = renderHookWithQuery(() => usePipelineStages())

    await waitFor(() =>
      expect(result.current.stages.map((s) => s.code)).toEqual(["FIRST", "SECOND"]),
    )
  })

  it("hides deactivated stages from a picker", async () => {
    makePipelineStage({ code: "CURRENT", sort_order: 10, is_active: true })
    makePipelineStage({ code: "RETIRED", sort_order: 20, is_active: false })

    const { result } = renderHookWithQuery(() => usePipelineStages())

    await waitFor(() =>
      expect(result.current.stages.map((s) => s.code)).toEqual(["CURRENT"]),
    )
  })

  it("includes deactivated stages when asked, so an opportunity in one still renders", async () => {
    makePipelineStage({ code: "CURRENT", sort_order: 10, is_active: true })
    makePipelineStage({ code: "RETIRED", sort_order: 20, is_active: false })

    const { result } = renderHookWithQuery(() =>
      usePipelineStages({ includeInactive: true }),
    )

    await waitFor(() =>
      expect(result.current.stages.map((s) => s.code)).toEqual(["CURRENT", "RETIRED"]),
    )
  })

  it("keeps a renamed stage's code so stored opportunities still match it", async () => {
    makePipelineStage({ code: "NEGOTIATION", label: "Haggling", sort_order: 10 })

    const { result } = renderHookWithQuery(() => usePipelineStages())

    await waitFor(() => expect(result.current.stages[0].label).toBe("Haggling"))
    expect(result.current.stages[0].code).toBe("NEGOTIATION")
  })
})
