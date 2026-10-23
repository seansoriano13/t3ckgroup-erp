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

  it("listens to the broadcast channel of both meeting tables", () => {
    const { unmount } = renderHookWithQuery(() => useMeetingRealtime())
    expect(state.handlers.map((h) => h.topic)).toEqual([
      "meeting_requests-changes",
      "meeting_request_participants-changes",
    ])
    unmount()
  })

  it("a change refreshes the Calendar and every Meeting Request query", () => {
    const { client: queryClient, unmount } = renderHookWithQuery(() => useMeetingRealtime())
    const spy = vi.spyOn(queryClient, "invalidateQueries")
    state.handlers[0].handler({})
    const keys = spy.mock.calls.map((c) => c[0].queryKey)
    expect(keys).toEqual([["calendar-entries"], ["meeting-requests"]])
    unmount()
  })

  it("shares one channel per table between screens and removes them when the last one unmounts", () => {
    const a = renderHookWithQuery(() => useMeetingRealtime())
    const b = renderHookWithQuery(() => useMeetingRealtime())
    expect(supabase.channel).toHaveBeenCalledTimes(2)
    a.unmount()
    expect(supabase.removeChannel).not.toHaveBeenCalled()
    b.unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(2)
  })
})
