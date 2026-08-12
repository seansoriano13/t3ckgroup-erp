import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useTheme } from "./useTheme"

/**
 * Theme selection, persisted per browser. The hook writes onto the document
 * element, so what it does to the DOM is the behaviour, not the state value.
 */
describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.className = ""
    document.documentElement.removeAttribute("data-theme")
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("starts light when nothing has been chosen before", () => {
    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe("light")
  })

  it("restores the previously chosen theme", () => {
    localStorage.setItem("theme", "dark")

    const { result } = renderHook(() => useTheme())

    expect(result.current.theme).toBe("dark")
  })

  it("applies the theme to the document element", () => {
    localStorage.setItem("theme", "dark")

    renderHook(() => useTheme())

    expect(document.documentElement.classList.contains("dark")).toBe(true)
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark")
  })

  it("toggles between light and dark", () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe("dark")

    act(() => result.current.toggleTheme())
    expect(result.current.theme).toBe("light")
  })

  it("replaces the previous theme class rather than stacking them", () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.toggleTheme())

    expect(document.documentElement.classList.contains("light")).toBe(false)
    expect(document.documentElement.classList.contains("dark")).toBe(true)
  })

  it("remembers the choice for the next visit", () => {
    const { result } = renderHook(() => useTheme())

    act(() => result.current.toggleTheme())

    expect(localStorage.getItem("theme")).toBe("dark")
  })
})
