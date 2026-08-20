import { beforeEach, describe, expect, it, vi } from "vitest"
import { useTableRealtime } from "./useTableRealtime"
import { renderHookWithQuery } from "@/test/support"

/**
 * The fake Supabase has no WebSocket layer (docs/testing.md — "Realtime is
 * inert"), so the channel's `.on()` callback is captured here and invoked
 * directly, the same way MSW bypasses HTTP for the rest of the suite.
 */
const channelState = vi.hoisted(() => ({ handlers: [] }))

vi.mock("../lib/supabase", () => {
  const channel = {
    on: vi.fn((_type, _filter, handler) => {
      channelState.handlers.push(handler)
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  return {
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
      realtime: { setAuth: vi.fn(() => Promise.resolve()) },
    },
  }
})

import { supabase } from "../lib/supabase"

describe("useTableRealtime", () => {
  beforeEach(() => {
    channelState.handlers = []
    vi.clearAllMocks()
  })

  it("subscribes to the table's broadcast channel as a private channel", () => {
    renderHookWithQuery(() => useTableRealtime("tasks", { invalidateKeys: [["tasks"]] }))

    // Private, not public: a public channel bypasses the realtime.messages
    // RLS policy entirely, which is the whole point of using Broadcast for a
    // table with no RLS of its own — see docs/realtime-policy.md.
    expect(supabase.channel).toHaveBeenCalledWith("tasks-changes", { config: { private: true } })
  })

  it("invalidates every given query key when a change is broadcast", () => {
    const { client } = renderHookWithQuery(() =>
      useTableRealtime("tasks", { invalidateKeys: [["tasks"], ["dashboardTasks"]] }),
    )
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")

    expect(channelState.handlers).toHaveLength(1)
    channelState.handlers[0]({ event: "UPDATE" })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["tasks"] })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboardTasks"] })
  })

  it("does nothing when there are no keys to invalidate", () => {
    renderHookWithQuery(() => useTableRealtime("tasks", { invalidateKeys: [] }))

    expect(supabase.channel).not.toHaveBeenCalled()
  })

  it("does nothing without a table", () => {
    renderHookWithQuery(() => useTableRealtime(null, { invalidateKeys: [["tasks"]] }))

    expect(supabase.channel).not.toHaveBeenCalled()
  })

  it("tears the channel down on unmount", () => {
    const { unmount } = renderHookWithQuery(() =>
      useTableRealtime("tasks", { invalidateKeys: [["tasks"]] }),
    )

    unmount()

    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })
})
