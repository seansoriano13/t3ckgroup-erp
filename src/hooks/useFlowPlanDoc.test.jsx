import { act } from "react"
import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { renderHookWithQuery } from "@/test/support"
import { base64ToBytes, bytesToBase64 } from "@/lib/bytes"
import { addStage, createFlowPlanDoc, encodeFlowPlanState, readFlowPlan } from "@/lib/flowPlanDoc"
import { useFlowPlanDoc } from "./useFlowPlanDoc"

/**
 * The document decides how two edits merge; this hook only carries them. So
 * what is tested here is delivery: that a local change goes out, that a change
 * arriving comes in, and that joining asks the room for whatever this session
 * missed — the last being what makes a dropped connection reconcile on return
 * rather than clobber.
 *
 * The fake Supabase has no WebSocket layer (docs/testing.md — "Realtime is
 * inert"), so the channel's handlers are captured and invoked directly, the way
 * `useTableRealtime.test.jsx` does.
 */
const realtime = vi.hoisted(() => ({ current: null }))
const persisted = vi.hoisted(() => ({ plan: null, saves: [] }))

vi.mock("../lib/supabase", () => {
  const channel = {
    state: "closed",
    sent: [],
    handlers: {},
    on: vi.fn((type, filter, handler) => {
      channel.handlers[`${type}:${filter.event}`] = handler
      return channel
    }),
    subscribe: vi.fn((callback) => {
      channel.state = "joined"
      callback?.("SUBSCRIBED")
      return channel
    }),
    unsubscribe: vi.fn(() => Promise.resolve("ok")),
    send: vi.fn((message) => {
      channel.sent.push(message)
      return Promise.resolve("ok")
    }),
  }
  realtime.current = channel
  return {
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      realtime: { setAuth: vi.fn(() => Promise.resolve()) },
    },
  }
})

vi.mock("../services/flowPlanService", () => ({
  flowPlanService: {
    getPlan: vi.fn(() => Promise.resolve(persisted.plan)),
    saveState: vi.fn((id, doc) => {
      persisted.saves.push(encodeFlowPlanState(doc))
      return Promise.resolve()
    }),
  },
}))

const sentOfType = (event) => realtime.current.sent.filter((message) => message.event === event)

describe("useFlowPlanDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realtime.current.sent = []
    realtime.current.handlers = {}
    realtime.current.state = "closed"
    persisted.plan = null
    persisted.saves = []
  })

  const mount = async () => {
    const rendered = renderHookWithQuery(() => useFlowPlanDoc("plan-1"))
    await waitFor(() => expect(rendered.result.current.isLoading).toBe(false))
    return rendered
  }

  it("opens the plan's own channel, so two plans never cross", async () => {
    const { supabase } = await import("../lib/supabase")
    await mount()

    expect(supabase.channel).toHaveBeenCalledWith("flow_plan_doc_plan-1", expect.anything())
  })

  it("loads what was stored for the plan", async () => {
    const stored = createFlowPlanDoc()
    addStage(stored, { name: "Lead" })
    persisted.plan = { yjs_state: encodeFlowPlanState(stored) }

    const { result } = await mount()

    expect(readFlowPlan(result.current.doc).stages.map((s) => s.name)).toEqual(["Lead"])
  })

  it("broadcasts a local edit to the room", async () => {
    const { result } = await mount()

    act(() => {
      addStage(result.current.doc, { name: "Qualified" })
    })

    const [update] = sentOfType("update")
    const peer = createFlowPlanDoc()
    Y.applyUpdate(peer, base64ToBytes(update.payload.update))
    expect(readFlowPlan(peer).stages.map((s) => s.name)).toEqual(["Qualified"])
  })

  it("applies an edit that arrives, and does not echo it back out", async () => {
    const { result } = await mount()
    const peer = createFlowPlanDoc()
    addStage(peer, { name: "From Ben" })

    act(() => {
      realtime.current.handlers["broadcast:update"]({
        payload: { update: bytesToBase64(encodeFlowPlanState(peer)) },
      })
    })

    expect(readFlowPlan(result.current.doc).stages.map((s) => s.name)).toEqual(["From Ben"])
    // Re-broadcasting a peer's own update back at the room is how an echo loop
    // starts; a remote-origin update must stay silent.
    expect(sentOfType("update")).toEqual([])
  })

  it("asks the room for what it missed when it joins", async () => {
    await mount()

    const [request] = sentOfType("sync-request")
    expect(request).toBeTruthy()
    expect(base64ToBytes(request.payload.stateVector)).toBeInstanceOf(Uint8Array)
  })

  it("answers a returning session with exactly what it has not seen", async () => {
    // This session has two stages; the asker only ever saw the first.
    const { result } = await mount()
    act(() => {
      addStage(result.current.doc, { name: "Lead" })
    })

    const asker = createFlowPlanDoc()
    Y.applyUpdate(asker, encodeFlowPlanState(result.current.doc))

    act(() => {
      addStage(result.current.doc, { name: "Qualified" })
    })
    realtime.current.sent = []

    act(() => {
      realtime.current.handlers["broadcast:sync-request"]({
        payload: { stateVector: bytesToBase64(Y.encodeStateVector(asker)) },
      })
    })

    const [answer] = sentOfType("update")
    Y.applyUpdate(asker, base64ToBytes(answer.payload.update))
    expect(readFlowPlan(asker).stages.map((s) => s.name)).toEqual(["Lead", "Qualified"])
  })

  it("reconciles rather than clobbering when a session returns with its own offline edits", async () => {
    const { result } = await mount()
    act(() => {
      addStage(result.current.doc, { name: "Lead" })
    })

    // Ben forked here, went away, and edited on his own.
    const ben = createFlowPlanDoc()
    Y.applyUpdate(ben, encodeFlowPlanState(result.current.doc))
    addStage(ben, { name: "Ben's offline stage" })

    // Meanwhile this session kept working.
    act(() => {
      addStage(result.current.doc, { name: "Qualified" })
    })

    // Ben comes back: he sends what he has, and gets back what he missed.
    act(() => {
      realtime.current.handlers["broadcast:update"]({
        payload: { update: bytesToBase64(Y.encodeStateAsUpdate(ben)) },
      })
    })
    act(() => {
      realtime.current.handlers["broadcast:sync-request"]({
        payload: { stateVector: bytesToBase64(Y.encodeStateVector(ben)) },
      })
    })
    const answer = sentOfType("update").at(-1)
    Y.applyUpdate(ben, base64ToBytes(answer.payload.update))

    const names = (doc) => readFlowPlan(doc).stages.map((s) => s.name).sort()
    expect(names(ben)).toEqual(["Ben's offline stage", "Lead", "Qualified"])
    expect(names(result.current.doc)).toEqual(names(ben))
  })

  it("saves a local edit, and flushes one made a moment before navigating away", async () => {
    const { flowPlanService } = await import("../services/flowPlanService")
    const { result, unmount } = await mount()

    act(() => {
      addStage(result.current.doc, { name: "Qualified" })
    })
    // The save is debounced, so nothing has been written yet.
    expect(flowPlanService.saveState).not.toHaveBeenCalled()

    unmount()

    expect(flowPlanService.saveState).toHaveBeenCalledTimes(1)
    const saved = createFlowPlanDoc()
    Y.applyUpdate(saved, persisted.saves[0])
    expect(readFlowPlan(saved).stages.map((s) => s.name)).toEqual(["Qualified"])
  })

  it("does not save on unmount when nothing was changed", async () => {
    const { flowPlanService } = await import("../services/flowPlanService")
    const { unmount } = await mount()

    unmount()

    expect(flowPlanService.saveState).not.toHaveBeenCalled()
  })
})
