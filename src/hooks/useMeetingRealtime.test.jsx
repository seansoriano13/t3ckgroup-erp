import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useMeetingRealtime } from "./useMeetingRealtime"
import { renderHookWithQuery } from "@/test/support"

const state = vi.hoisted(() => ({ handlers: [] }))

vi.mock("../lib/supabase", () => {
  const make = (topic) => {
    const channel = {
      topic,
      on: vi.fn((_type, _filter, handler) => {
        state.handlers.push({ topic, handler })
        return channel
      }),
      subscribe: vi.fn(() => channel),
    }
    return channel
  }
  return {
    supabase: {
      channel: vi.fn((topic) => make(topic)),
      removeChannel: vi.fn(),
      realtime: { setAuth: vi.fn(() => Promise.resolve()) },
    },
  }
})

import { supabase } from "../lib/supabase"

describe("useMeetingRealtime", () => {
  beforeEach(() => {
    state.handlers = []
    vi.clearAllMocks()
  })

  it("listens to the broadcast channel of all three meeting tables", () => {
    const { unmount } = renderHookWithQuery(() => useMeetingRealtime())
    expect(state.handlers.map((h) => h.topic)).toEqual([
      "meeting_requests-changes",
      "meeting_request_participants-changes",
      "meeting_request_days-changes",
    ])
    unmount()
  })

  it("a change refreshes the Calendar and every Meeting Request query, once", async () => {
    const { client: queryClient, unmount } = renderHookWithQuery(() => useMeetingRealtime())
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    state.handlers[0].handler({})
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    const { predicate } = spy.mock.calls[0][0]
    const matches = (key) => predicate({ queryKey: key })
    expect(matches(["calendar-entries", "2031-03-01", "2031-03-31", false])).toBe(true)
    expect(matches(["meeting-requests", "mine", "u1"])).toBe(true)
    expect(matches(["employees"])).toBe(false)
    unmount()
  })

  it("a burst of signals on all three tables is one refresh", async () => {
    const { client: queryClient, unmount } = renderHookWithQuery(() => useMeetingRealtime())
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    state.handlers.forEach((h) => h.handler({}))
    state.handlers.forEach((h) => h.handler({}))
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 400))
    expect(spy).toHaveBeenCalledTimes(1)
    unmount()
  })

  it("shares one channel per table between screens and removes them when the last one unmounts", () => {
    const a = renderHookWithQuery(() => useMeetingRealtime())
    const b = renderHookWithQuery(() => useMeetingRealtime())
    expect(supabase.channel).toHaveBeenCalledTimes(3)
    a.unmount()
    expect(supabase.removeChannel).not.toHaveBeenCalled()
    b.unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(3)
  })
})
