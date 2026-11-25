/**
 * IPAS Status: For Payment, In Production and Ready for Shipment (#1206, spec #1205): the database rules.
 *
 * The migration moved every IPAS on `processing` to `in_production` (with its dated step row) and carried the
 * `processing` Ageing rule over. That data move ran once, on the rows that existed when the migration was applied;
 * this harness builds the schema from empty, so it holds no IPAS on `processing` to move and cannot replay it.
 * What is proven here is the state the move leaves behind (nothing is left on `processing`, the Ageing rule sits
 * on `in_production`, the checks refuse the old word) and the label function that reads a stored `processing` as
 * In Production, which is what an old status-history entry relies on. These tests need the local stack (Docker).
 */
import { describe, it, expect, beforeAll } from "vitest"
import { ensureCastLoaded } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"

const svc = () => serviceClient()

beforeAll(async () => {
    await ensureCastLoaded()
})

describe("the step words", () => {
    const label = async (step) => {
        const { data, error } = await svc().rpc("_ipas_status_label", { p_step: step })
        if (error) throw new Error(`_ipas_status_label(${step}): ${error.message}`)
        return data
    }

    it("names the new steps", async () => {
        expect(await label("for_payment")).toBe("For Payment")
        expect(await label("in_production")).toBe("In Production")
        expect(await label("ready_for_shipment")).toBe("Ready for Shipment")
    })

    it("reads a stored 'processing' as In Production, so an old entry never shows the raw word", async () => {
        expect(await label("processing")).toBe("In Production")
    })
})

describe("what the processing move leaves behind", () => {
    it("has no IPAS and no dated step row on processing", async () => {
        const onIpas = await svc().from("ipas").select("id", { count: "exact", head: true }).eq("status", "processing")
        expect(onIpas.error).toBeNull()
        expect(onIpas.count).toBe(0)
        const onSteps = await svc().from("ipas_status_steps").select("ipas_id", { count: "exact", head: true }).eq("step", "processing")
        expect(onSteps.error).toBeNull()
        expect(onSteps.count).toBe(0)
    })

    it("keeps the Ageing rule on in_production, with ready_for_shipment added and processing gone (for_payment left in #1221)", async () => {
        const { data, error } = await svc().from("order_ageing_rules").select("step").in("step", ["processing", "in_production", "for_payment", "ready_for_shipment"])
        expect(error).toBeNull()
        expect(data.map((r) => r.step).sort()).toEqual(["in_production", "ready_for_shipment"])
    })

    it("refuses the old word as an Ageing rule step", async () => {
        const refused = await svc().from("order_ageing_rules").insert({ step: "processing" })
        expect(refused.error?.code).toBe("23514")
    })
})
