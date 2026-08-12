import { waitFor } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useEmployeeAvatarMap } from "./useEmployeeAvatarMap"
import { renderHookWithQuery } from "@/test/support"
import { makeEmployee } from "@/test/factories"

/**
 * One shared avatar lookup for the whole session. Components read it on every
 * row of every list, so it must return something usable immediately rather
 * than forcing each caller to handle a loading state.
 */
describe("useEmployeeAvatarMap", () => {
  it("returns an empty map before the fetch resolves", () => {
    makeEmployee({ name: "Ana Reyes", avatar_path: "https://cdn.test/ana.png" })

    const { result } = renderHookWithQuery(() => useEmployeeAvatarMap())

    expect(result.current).toBeInstanceOf(Map)
    expect(result.current.size).toBe(0)
  })

  it("maps each employee to their picture", async () => {
    const ana = makeEmployee({ name: "Ana Reyes", avatar_path: "https://cdn.test/ana.png" })

    const { result } = renderHookWithQuery(() => useEmployeeAvatarMap())

    await waitFor(() => expect(result.current.size).toBeGreaterThan(0))
    expect(result.current.get(ana.id)).toBe("https://cdn.test/ana.png")
  })

  it("maps an employee with no picture to null rather than omitting them", async () => {
    const ben = makeEmployee({ name: "Ben Cruz", avatar_path: null })

    const { result } = renderHookWithQuery(() => useEmployeeAvatarMap())

    await waitFor(() => expect(result.current.has(ben.id)).toBe(true))
    expect(result.current.get(ben.id)).toBeNull()
  })

  it("resolves a legacy storage path to a placeholder instead of a dead link", async () => {
    const cara = makeEmployee({ name: "Cara Lim", avatar_path: "avatars/cara.png" })

    const { result } = renderHookWithQuery(() => useEmployeeAvatarMap())

    await waitFor(() => expect(result.current.size).toBeGreaterThan(0))
    expect(result.current.get(cara.id).startsWith("data:image/gif;base64,")).toBe(true)
  })

  it("leaves out deactivated employees", async () => {
    const active = makeEmployee({ name: "Ana Reyes", avatar_path: "https://cdn.test/ana.png" })
    const gone = makeEmployee({ name: "Gone", avatar_path: "https://cdn.test/gone.png", is_deleted: true })

    const { result } = renderHookWithQuery(() => useEmployeeAvatarMap())

    await waitFor(() => expect(result.current.size).toBeGreaterThan(0))
    expect(result.current.has(active.id)).toBe(true)
    expect(result.current.has(gone.id)).toBe(false)
  })

  it("fetches once for every component that asks", async () => {
    makeEmployee({ name: "Ana Reyes", avatar_path: "https://cdn.test/ana.png" })
    const { client } = renderHookWithQuery(() => useEmployeeAvatarMap())

    const second = renderHookWithQuery(() => useEmployeeAvatarMap(), { client })

    await waitFor(() => expect(second.result.current.size).toBeGreaterThan(0))
    expect(client.getQueryCache().findAll({ queryKey: ["employeeAvatarMap"] })).toHaveLength(1)
  })
})
