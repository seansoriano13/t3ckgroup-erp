import { beforeEach, describe, expect, it, vi } from "vitest"
import { useMeetingRealtime } from "./useMeetingRealtime"
import { renderHookWithQuery } from "@/test/support"

const state = vi.hoisted(() => ({ handlers: [] }))

vi.mock("../lib/supabase", () => {
  const channel = {
    on: vi.fn((_type, filter, handler) => {
      state.handlers.push({ filter, handler })
      return channel
    }),
    subscribe: vi.fn(() => channel),
  }
  return { supabase: { channel: vi.fn(() => channel), removeChannel: vi.fn() } }
})

import { supabase } from "../lib/supabase"

describe("useMeetingRealtime", () => {
  beforeEach(() => {
    state.handlers = []
    vi.clearAllMocks()
  })

  it("listens to postgres_changes on both meeting tables", () => {
    const { unmount } = renderHookWithQuery(() => useMeetingRealtime())
    expect(state.handlers.map((h) => h.filter.table)).toEqual(["meeting_requests", "meeting_request_participants"])
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

  it("shares one channel between screens and removes it when the last one unmounts", () => {
    const a = renderHookWithQuery(() => useMeetingRealtime())
    const b = renderHookWithQuery(() => useMeetingRealtime())
    expect(supabase.channel).toHaveBeenCalledTimes(1)
    a.unmount()
    expect(supabase.removeChannel).not.toHaveBeenCalled()
    b.unmount()
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1)
  })
})
