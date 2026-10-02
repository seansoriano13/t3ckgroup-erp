import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "@testing-library/react"
import { useRetailArrivals, ARRIVAL_HIGHLIGHT_MS } from "./useRetailArrivals"
import { renderHookWithQuery } from "@/test/support"

/**
 * The fake Supabase has no WebSocket layer (docs/testing.md — "Realtime is
 * inert"), so the channel's `.on()` callback is captured and invoked directly.
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

const rows = (...ids) => ids.map((id) => ({ id }))

describe("useRetailArrivals", () => {
  beforeEach(() => {
    channelState.handlers = []
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  const mount = (initial) =>
    renderHookWithQuery(({ orders, ready }) => useRetailArrivals(orders, ready), {
      initialProps: initial,
    })

  it("listens to retail_orders and refetches the Retail orders when one changes", () => {
    const { client } = mount({ orders: rows("a"), ready: true })
    const invalidateSpy = vi.spyOn(client, "invalidateQueries")

    expect(supabase.channel).toHaveBeenCalledWith("retail_orders-changes", { config: { private: true } })

    channelState.handlers[0]({ event: "UPDATE" })
    act(() => vi.advanceTimersByTime(2000))

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["retailOrders"] })
  })

  it("highlights nothing on the first load: every order already there is not an arrival", () => {
    const { result } = mount({ orders: rows("a", "b"), ready: true })

    expect(result.current.size).toBe(0)
  })

  it("waits for the first load before taking its baseline", () => {
    const { result, rerender } = mount({ orders: [], ready: false })
    rerender({ orders: rows("a", "b"), ready: true })

    expect(result.current.size).toBe(0)
  })

  it("highlights an order that shows up after the first load, and only that one", () => {
    const { result, rerender } = mount({ orders: rows("a", "b"), ready: true })

    rerender({ orders: rows("a", "b", "c"), ready: true })

    expect([...result.current]).toEqual(["c"])
  })

  it("drops the highlight after a few seconds", () => {
    const { result, rerender } = mount({ orders: rows("a"), ready: true })
    rerender({ orders: rows("a", "b"), ready: true })
    expect(result.current.has("b")).toBe(true)

    act(() => vi.advanceTimersByTime(ARRIVAL_HIGHLIGHT_MS - 1))
    expect(result.current.has("b")).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.has("b")).toBe(false)
  })

  it("keeps an earlier arrival highlighted when a later one lands, each expiring on its own clock", () => {
    const { result, rerender } = mount({ orders: rows("a"), ready: true })
    rerender({ orders: rows("a", "b"), ready: true })
    act(() => vi.advanceTimersByTime(ARRIVAL_HIGHLIGHT_MS / 2))
    rerender({ orders: rows("a", "b", "c"), ready: true })
    expect([...result.current].sort()).toEqual(["b", "c"])

    act(() => vi.advanceTimersByTime(ARRIVAL_HIGHLIGHT_MS / 2))
    expect([...result.current]).toEqual(["c"])
  })

  it("does not highlight an order again when a refetch returns the same ones", () => {
    const { result, rerender } = mount({ orders: rows("a", "b"), ready: true })

    rerender({ orders: rows("b", "a"), ready: true })

    expect(result.current.size).toBe(0)
  })
})
