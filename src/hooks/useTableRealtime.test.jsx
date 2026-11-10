import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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

  it("invalidates just the one key a single-key consumer passes, like the Dashboard", () => {
    const { client } = renderHookWithQuery(() =>
      useTableRealtime("tasks", { invalidateKeys: [["dashboardTasks"]] }),
    )
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")

    channelState.handlers[0]({ event: "INSERT" })

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboardTasks"] })
  })

  describe("debounceMs", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("turns a burst of signals into one invalidation at the end of it", () => {
      const { client } = renderHookWithQuery(() =>
        useTableRealtime("sales_opportunities", { invalidateKeys: [["opportunities"]], debounceMs: 500 }),
      )
      const invalidateSpy = vi.spyOn(client, "invalidateQueries")

      for (let i = 0; i < 5; i += 1) {
        channelState.handlers[0]({ event: "UPDATE" })
        vi.advanceTimersByTime(100)
      }
      expect(invalidateSpy).not.toHaveBeenCalled()

      vi.advanceTimersByTime(500)
      expect(invalidateSpy).toHaveBeenCalledTimes(1)
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["opportunities"] })
    })

    it("drops a pending invalidation when the consumer unmounts", () => {
      const { client, unmount } = renderHookWithQuery(() =>
        useTableRealtime("sales_opportunities", { invalidateKeys: [["opportunities"]], debounceMs: 500 }),
      )
      const invalidateSpy = vi.spyOn(client, "invalidateQueries")

      channelState.handlers[0]({ event: "UPDATE" })
      unmount()
      vi.advanceTimersByTime(1000)

      expect(invalidateSpy).not.toHaveBeenCalled()
    })
  })

  it("does nothing when there are no keys to invalidate", () => {
    renderHookWithQuery(() => useTableRealtime("tasks", { invalidateKeys: [] }))

    expect(supabase.channel).not.toHaveBeenCalled()
  })

  it("does nothing without a table", () => {
    renderHookWithQuery(() => useTableRealtime(null, { invalidateKeys: [["tasks"]] }))

    expect(supabase.channel).not.toHaveBeenCalled()
  })

  it("shares one channel between two consumers of a table, until the last one leaves", () => {
    const first = renderHookWithQuery(() => useTableRealtime("tasks", { invalidateKeys: [["tasks"]] }))
    const second = renderHookWithQuery(() => useTableRealtime("tasks", { invalidateKeys: [["dashboardTasks"]] }))
    const spy = vi.spyOn(second.client, "invalidateQueries")

    expect(supabase.channel).toHaveBeenCalledTimes(1)
    first.unmount()
    expect(supabase.removeChannel).not.toHaveBeenCalled()

    channelState.handlers[0]({ event: "UPDATE" })
    expect(spy).toHaveBeenCalledWith({ queryKey: ["dashboardTasks"] })

    second.unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })

  it("tears the channel down on unmount", () => {
    const { unmount } = renderHookWithQuery(() =>
      useTableRealtime("tasks", { invalidateKeys: [["tasks"]] }),
    )

    unmount()

    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })
})
