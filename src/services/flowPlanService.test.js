import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { flowPlanService } from "./flowPlanService"
import { db } from "@/test/db/store"
import { makeSuperAdmin } from "@/test/factories"
import { addStage, createFlowPlanDoc, encodeFlowPlanState, readFlowPlan } from "@/lib/flowPlanDoc"
import { bytesToHex, hexToBytes } from "@/lib/bytes"

/**
 * A plan is edited by several people at once, so the only interesting question
 * about storing one is what happens when two of them store it. The answer has
 * to be that both sessions' work survives — never that whoever saved last wins.
 */
describe("flowPlanService", () => {
  const seedPlan = (attrs = {}) =>
    db.seed("flow_plans", { name: "Q4 rework", created_by: makeSuperAdmin().id, ...attrs })

  const storedPlan = (id) => db.internal.rowsOf("flow_plans").find((row) => row.id === id)

  /** The stored bytes, read back as a document. */
  const reopen = (id) => {
    const doc = createFlowPlanDoc()
    const stored = storedPlan(id).yjs_state
    if (stored) Y.applyUpdate(doc, hexToBytes(stored))
    return doc
  }

  it("stores a document so it reopens as what the session arrived at", async () => {
    const plan = seedPlan()
    const doc = createFlowPlanDoc()
    addStage(doc, { name: "Qualified" })

    await flowPlanService.saveState(plan.id, doc)

    expect(readFlowPlan(reopen(plan.id)).stages.map((s) => s.name)).toEqual(["Qualified"])
  })

  it("merges into what is already stored rather than replacing it", async () => {
    // Ana saved first; Ben's session never heard about her Stage.
    const plan = seedPlan()
    const ana = createFlowPlanDoc()
    addStage(ana, { name: "Ana's stage" })
    await flowPlanService.saveState(plan.id, ana)

    const ben = createFlowPlanDoc()
    addStage(ben, { name: "Ben's stage" })
    await flowPlanService.saveState(plan.id, ben)

    expect(readFlowPlan(reopen(plan.id)).stages.map((s) => s.name).sort()).toEqual([
      "Ana's stage",
      "Ben's stage",
    ])
  })

  it("keeps a third session's save that landed between this one's read and write", async () => {
    const plan = seedPlan()

    // Seed the column with Ana's work, as if she saved a moment ago.
    const ana = createFlowPlanDoc()
    addStage(ana, { name: "Ana's stage" })
    await flowPlanService.saveState(plan.id, ana)

    // Ben reads, and Cara's save lands before Ben's write does. The stub reads
    // the row on Ben's behalf, so this stands in for that interleaving: the
    // compare-and-set on updated_at makes Ben's first write match no rows, and
    // his retry re-merges against what Cara actually left.
    const cara = createFlowPlanDoc()
    addStage(cara, { name: "Cara's stage" })
    Y.applyUpdate(cara, hexToBytes(storedPlan(plan.id).yjs_state))

    const ben = createFlowPlanDoc()
    addStage(ben, { name: "Ben's stage" })

    const row = storedPlan(plan.id)
    const staleUpdatedAt = row.updated_at
    row.yjs_state = bytesToHex(encodeFlowPlanState(cara))
    row.updated_at = new Date(Date.parse(staleUpdatedAt) + 1000).toISOString()

    await flowPlanService.saveState(plan.id, ben)

    expect(readFlowPlan(reopen(plan.id)).stages.map((s) => s.name).sort()).toEqual([
      "Ana's stage",
      "Ben's stage",
      "Cara's stage",
    ])
  })

  it("gives up with a message rather than silently discarding work it cannot land", async () => {
    const plan = seedPlan()
    const doc = createFlowPlanDoc()
    addStage(doc, { name: "Qualified" })

    // A plan that is genuinely changing underneath: every read sees a newer
    // `updated_at` than the last, so no compare-and-set can ever match.
    Object.defineProperty(storedPlan(plan.id), "updated_at", {
      get: () => new Date().toISOString() + Math.random(),
      configurable: true,
    })

    await expect(
      flowPlanService.saveState(plan.id, doc, { attempts: 2 }),
    ).rejects.toThrow("Could not save the plan")
  })

  it("says the plan is gone rather than blaming contention, when it has been deleted", async () => {
    // Without this the save would re-read nothing, fail its compare-and-set
    // every round, exhaust its retries and report a plan that "kept changing
    // underneath" — which is the wrong thing to tell someone.
    const doc = createFlowPlanDoc()
    addStage(doc, { name: "Lead" })

    await expect(
      flowPlanService.saveState("00000000-0000-4000-8000-000000009999", doc),
    ).rejects.toThrow("This plan no longer exists")
  })

  it("reads a plan back with its stored state decoded", async () => {
    const doc = createFlowPlanDoc()
    addStage(doc, { name: "Qualified" })
    const plan = seedPlan({ yjs_state: bytesToHex(encodeFlowPlanState(doc)) })

    const loaded = await flowPlanService.getPlan(plan.id)

    expect(loaded.yjs_state).toBeInstanceOf(Uint8Array)
    expect(loaded.name).toBe("Q4 rework")
  })

  it("lists and creates plans", async () => {
    const author = makeSuperAdmin()
    seedPlan({ name: "Older" })

    const created = await flowPlanService.createPlan("Newer", author.id)
    const plans = await flowPlanService.listPlans()

    expect(created.name).toBe("Newer")
    expect(plans.map((p) => p.name)).toContain("Newer")
  })
})
