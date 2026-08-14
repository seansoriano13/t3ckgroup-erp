import { describe, expect, it } from "vitest"
import { supabase } from "./supabase"
import { stubEdgeFunction } from "@/test/msw/server"

/**
 * The fetch wrapper every Supabase call in the app goes through.
 *
 * Its 20s timeout and its retry-on-failure are what keep a flaky connection
 * from surfacing as a dead UI. They are also what made S07813 — a quotation
 * with forty brochures merged into it — impossible to download: Odoo needs
 * minutes to render that, the client gave up at 20s, and the retry then
 * started the same render again while the first was still going.
 *
 * The way out is the caller's own AbortSignal. Bringing one means "I am
 * managing this deadline", and the wrapper stands aside — no default timeout
 * layered on top, and no going round again once it fires. Both halves are
 * pinned here, along with the ordinary behaviour they must not disturb.
 */
describe("supabase customFetch", () => {
  const holdFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  it("lets a caller-supplied deadline outlast what it is given", async () => {
    let calls = 0
    stubEdgeFunction("slow", async () => {
      calls += 1
      await holdFor(40)
      return { ok: true }
    })

    const { error } = await supabase.functions.invoke("slow", {
      body: {},
      signal: AbortSignal.timeout(2000),
    })

    expect(error).toBeNull()
    expect(calls).toBe(1)
  })

  it("does not retry a request that already spent its whole deadline", async () => {
    let calls = 0
    stubEdgeFunction("stalled", async () => {
      calls += 1
      await holdFor(400)
      return { ok: true }
    })

    const { error } = await supabase.functions.invoke("stalled", {
      body: {},
      signal: AbortSignal.timeout(50),
    })

    expect(error).toBeTruthy()
    // The whole point: one attempt, not three. A second render stacked on the
    // first is what turned a slow S07813 download into a hopeless one.
    expect(calls).toBe(1)
  })

  it("still retries a transient failure on an ordinary request", async () => {
    let calls = 0
    stubEdgeFunction("flaky", () => {
      calls += 1
      if (calls < 3) return new Response(null, { status: 503 })
      return Response.json({ ok: true })
    })

    const { data, error } = await supabase.functions.invoke("flaky", { body: {} })

    expect(error).toBeNull()
    expect(data).toEqual({ ok: true })
    expect(calls).toBe(3)
  })

  it("honours a caller's cancellation, not just a timeout", async () => {
    stubEdgeFunction("cancelled", async () => {
      await holdFor(400)
      return { ok: true }
    })

    const controller = new AbortController()
    const invocation = supabase.functions.invoke("cancelled", {
      body: {},
      signal: controller.signal,
    })
    controller.abort()

    const { error } = await invocation
    expect(error).toBeTruthy()
  })
})
