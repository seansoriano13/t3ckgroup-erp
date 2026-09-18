import { describe, it, expect, vi } from "vitest"
import { act, waitFor } from "@testing-library/react"
import { renderHookWithQuery } from "../../../test/support"
import { useOpenedTabs, useSorModalData } from "./useSorModalData"

describe("useOpenedTabs", () => {
  it("starts with only the initial tab opened", () => {
    const { result } = renderHookWithQuery(() => useOpenedTabs("now"))
    expect(result.current.hasOpened("now")).toBe(true)
    expect(result.current.hasOpened("journey")).toBe(false)
  })

  it("marks a tab opened and keeps it opened", () => {
    const { result } = renderHookWithQuery(() => useOpenedTabs("now"))
    act(() => result.current.markOpened("journey"))
    expect(result.current.hasOpened("journey")).toBe(true)
  })
})

describe("useSorModalData", () => {
  it("does not fetch a tab that hasn't been opened", () => {
    const queryFn = vi.fn().mockResolvedValue("journey-data")
    renderHookWithQuery(() =>
      useSorModalData({
        tab: "journey",
        opportunityId: "opp-1",
        queryFn,
        hasOpened: () => false,
      }),
    )
    expect(queryFn).not.toHaveBeenCalled()
  })

  it("fetches once a tab has been opened, and only once on revisit", async () => {
    const queryFn = vi.fn().mockResolvedValue("journey-data")
    const { result, rerender } = renderHookWithQuery(
      ({ hasOpened }) =>
        useSorModalData({
          tab: "journey",
          opportunityId: "opp-1",
          queryFn,
          hasOpened,
        }),
      { initialProps: { hasOpened: () => true } },
    )

    await waitFor(() => expect(result.current.data).toBe("journey-data"))
    expect(queryFn).toHaveBeenCalledTimes(1)

    // Switching away and back re-renders with the same opened tab — the
    // query key is unchanged, so React Query serves the cache, not a refetch.
    rerender({ hasOpened: () => true })
    await waitFor(() => expect(result.current.data).toBe("journey-data"))
    expect(queryFn).toHaveBeenCalledTimes(1)
  })
})
