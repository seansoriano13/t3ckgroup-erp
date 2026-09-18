import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderHookWithQuery } from "@/test/support"
import { peerColor, useFlowPresence } from "./useFlowPresence"

/**
 * The fake Supabase has no WebSocket layer (docs/testing.md — "Realtime is
 * inert"), so the channel's handlers are captured here and invoked directly,
 * the way `useTableRealtime.test.jsx` already does.
 */
const realtime = vi.hoisted(() => ({
  channels: [],
  current: null,
}))

vi.mock("../lib/supabase", () => {
  const makeChannel = (topic, config) => {
    const channel = {
      topic,
      config,
      state: "closed",
      presence: {},
      sent: [],
      tracked: null,
      untracked: false,
      unsubscribed: false,
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
      presenceState: () => channel.presence,
      track: vi.fn((payload) => {
        channel.tracked = payload
        return Promise.resolve("ok")
      }),
      untrack: vi.fn(() => {
        channel.untracked = true
        return Promise.resolve("ok")
      }),
      unsubscribe: vi.fn(() => {
        channel.unsubscribed = true
        channel.state = "closed"
        return Promise.resolve("ok")
      }),
      send: vi.fn((message) => {
        channel.sent.push(message)
        return Promise.resolve("ok")
      }),
    }
    realtime.channels.push(channel)
    realtime.current = channel
    return channel
  }

  return {
    supabase: {
      channel: vi.fn((topic, config) => makeChannel(topic, config)),
      removeChannel: vi.fn(),
      realtime: { setAuth: vi.fn(() => Promise.resolve()) },
    },
  }
})

const ana = { id: "ana", name: "Ana Reyes" }
const ben = { userId: "ben", name: "Ben Cruz", color: "#3b82f6" }

/** Pushes a presence roster onto the channel and fires the sync the server would. */
function syncPresence(channel, roster) {
  channel.presence = roster
  act(() => channel.handlers["presence:sync"]())
}

function broadcastToChannel(channel, event, payload) {
  act(() => channel.handlers[`broadcast:${event}`]({ payload }))
}

describe("useFlowPresence", () => {
  beforeEach(() => {
    realtime.channels = []
    realtime.current = null
    vi.clearAllMocks()
  })

  const render = (props = {}) =>
    renderHookWithQuery(() => useFlowPresence({ scopeId: "plan-1", user: ana, ...props }))

  it("scopes the channel to the plan being viewed, so two plans never share viewers", () => {
    render()
    render({ scopeId: "plan-2" })

    expect(realtime.channels.map((c) => c.topic)).toEqual([
      "flow_presence_plan-1",
      "flow_presence_plan-2",
    ])
  })

  it("announces the viewer by name once the channel is joined", () => {
    render()

    expect(realtime.current.tracked).toMatchObject({ userId: "ana", name: "Ana Reyes" })
    expect(realtime.current.tracked.color).toBe(peerColor("ana"))
  })

  it("lists everyone else viewing the plan", () => {
    const { result } = render()

    syncPresence(realtime.current, {
      ana: [{ userId: "ana", name: "Ana Reyes" }],
      ben: [ben],
    })

    expect(result.current.peers).toEqual([ben])
  })

  it("does not draw the viewer their own cursor", () => {
    const { result } = render()
    syncPresence(realtime.current, { ana: [{ userId: "ana" }], ben: [ben] })

    broadcastToChannel(realtime.current, "cursor", { userId: "ana", cursor: { x: 1, y: 2 } })
    broadcastToChannel(realtime.current, "cursor", { userId: "ben", cursor: { x: 8, y: 9 } })

    expect(result.current.cursors).toEqual({ ben: { x: 8, y: 9 } })
  })

  it("tracks a peer's cursor as it moves", () => {
    const { result } = render()
    syncPresence(realtime.current, { ben: [ben] })

    broadcastToChannel(realtime.current, "cursor", { userId: "ben", cursor: { x: 8, y: 9 } })
    broadcastToChannel(realtime.current, "cursor", { userId: "ben", cursor: { x: 40, y: 12 } })

    expect(result.current.cursors.ben).toEqual({ x: 40, y: 12 })
  })

  it("drops a departed viewer's cursor rather than leaving a ghost behind", () => {
    const { result } = render()
    syncPresence(realtime.current, { ben: [ben] })
    broadcastToChannel(realtime.current, "cursor", { userId: "ben", cursor: { x: 8, y: 9 } })
    expect(result.current.cursors.ben).toBeTruthy()

    syncPresence(realtime.current, {})

    expect(result.current.peers).toEqual([])
    expect(result.current.cursors).toEqual({})
  })

  it("leaves the room promptly when the viewer navigates away", () => {
    const { unmount } = render()
    const channel = realtime.current

    unmount()

    expect(channel.untracked).toBe(true)
    expect(channel.unsubscribed).toBe(true)
  })

  it("publishes the viewer's own cursor and drags to the room", () => {
    const { result } = render()

    act(() => {
      result.current.publishCursor({ x: 5, y: 6 })
      result.current.publishNodeDrag("stage-1", { x: 10, y: 20 })
    })

    expect(realtime.current.sent).toEqual([
      { type: "broadcast", event: "cursor", payload: { userId: "ana", cursor: { x: 5, y: 6 } } },
      {
        type: "broadcast",
        event: "node-drag",
        payload: { userId: "ana", nodeId: "stage-1", position: { x: 10, y: 20 } },
      },
    ])
  })

  it("hands a peer's drag to the canvas, and ignores its own echo", () => {
    const onPeerNodeDrag = vi.fn()
    render({ onPeerNodeDrag })

    broadcastToChannel(realtime.current, "node-drag", { userId: "ana", nodeId: "s1" })
    broadcastToChannel(realtime.current, "node-drag", { userId: "ben", nodeId: "s2", position: { x: 1, y: 2 } })

    expect(onPeerNodeDrag).toHaveBeenCalledTimes(1)
    expect(onPeerNodeDrag).toHaveBeenCalledWith({ userId: "ben", nodeId: "s2", position: { x: 1, y: 2 } })
  })

  it("joins nothing at all without a plan to be present in", () => {
    renderHookWithQuery(() => useFlowPresence({ scopeId: null, user: ana }))

    expect(realtime.channels).toEqual([])
  })
})
