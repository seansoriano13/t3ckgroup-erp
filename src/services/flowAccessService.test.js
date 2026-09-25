import { describe, expect, it } from "vitest"
import { flowAccessService } from "./flowAccessService"
import { makeSaleType, makeSalesFlow } from "@/test/factories"

describe("flowAccessService — Always edits", () => {
  it("saves Always edits beside Always sees and reads it back", async () => {
    const flowId = makeSalesFlow({ sale_type_id: makeSaleType().id }).id
    const alwaysEdits = [{ type: "everyone" }]

    const saved = await flowAccessService.saveForFlow(flowId, { alwaysSees: [], alwaysEdits })
    expect(saved.alwaysEdits).toEqual(alwaysEdits)

    const loaded = await flowAccessService.getForFlow(flowId)
    expect(loaded.alwaysEdits).toEqual(alwaysEdits)
    expect(loaded.alwaysSees).toEqual([])
  })

  it("defaults Always edits to empty", async () => {
    const flowId = makeSalesFlow({ sale_type_id: makeSaleType().id }).id
    const saved = await flowAccessService.saveForFlow(flowId, {})
    expect(saved.alwaysEdits).toEqual([])
  })
})
