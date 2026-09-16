import { describe, it, expect, vi, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useMediaQuery } from "./useMediaQuery"

function stubMatchMedia(initialMatches) {
  const listeners = new Set()
  let matches = initialMatches
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    query,
    get matches() {
      return matches
    },
    addEventListener: (_event, cb) => listeners.add(cb),
    removeEventListener: (_event, cb) => listeners.delete(cb),
  }))
  return {
    setMatches: (next) => {
      matches = next
      listeners.forEach((cb) => cb())
    },
  }
}

describe("useMediaQuery", () => {
  const original = window.matchMedia

  afterEach(() => {
    window.matchMedia = original
  })

  it("reflects the query's current match state", () => {
    stubMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery("(min-width: 1100px)"))
    expect(result.current).toBe(true)
  })

  it("updates when the query's match state changes", () => {
    const { setMatches } = stubMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery("(min-width: 1100px)"))
    expect(result.current).toBe(false)

    act(() => setMatches(true))
    expect(result.current).toBe(true)
  })
})
