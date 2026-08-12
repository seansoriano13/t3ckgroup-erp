import { waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { useProjectTitles } from "./useProjectTitles"
import { renderHookWithQuery } from "@/test/support"
import { makeCategory, makeEmployee, makeTask } from "@/test/factories"

/**
 * Feeds the project-title autocomplete on the log-task form. It merges titles
 * already in the React Query cache with what the database holds, so a title
 * typed a moment ago is suggested before the next fetch lands.
 */
describe("useProjectTitles", () => {
  let author
  let category

  beforeEach(() => {
    author = makeEmployee({ name: "Ana Reyes" })
    category = makeCategory({ category_id: "IT-01" })
  })

  const task = (overrides) =>
    makeTask({ logged_by: author.id, category_id: category.category_id, ...overrides })

  const titles = async (...args) => {
    const { result } = renderHookWithQuery(() => useProjectTitles(...args))
    await waitFor(() => expect(result.current.length).toBeGreaterThan(0))
    return result.current
  }

  it("suggests the distinct project titles already used", async () => {
    task({ project_title: "Network refresh" })
    task({ project_title: "Office move" })

    expect(await titles()).toEqual(["Network refresh", "Office move"])
  })

  it("sorts the suggestions alphabetically", async () => {
    task({ project_title: "Zebra project" })
    task({ project_title: "Alpha project" })

    expect(await titles()).toEqual(["Alpha project", "Zebra project"])
  })

  it("suggests a repeated title only once", async () => {
    task({ project_title: "Network refresh" })
    task({ project_title: "Network refresh" })

    expect(await titles()).toEqual(["Network refresh"])
  })

  it("treats titles differing only in case as the same suggestion", async () => {
    task({ project_title: "Network Refresh" })
    task({ project_title: "network refresh" })

    expect(await titles()).toHaveLength(1)
  })

  it("skips tasks with no project title", async () => {
    task({ project_title: null })
    task({ project_title: "" })
    task({ project_title: "Network refresh" })

    expect(await titles()).toEqual(["Network refresh"])
  })

  it("narrows to one employee's titles when asked", async () => {
    const colleague = makeEmployee({ name: "Ben Cruz" })
    task({ project_title: "Mine" })
    makeTask({
      logged_by: colleague.id,
      category_id: category.category_id,
      project_title: "Theirs",
    })

    expect(await titles(author.id)).toEqual(["Mine"])
  })

  it("includes titles held in the dashboard cache but not yet in the fetch", async () => {
    task({ project_title: "From the database" })
    const { client, result } = renderHookWithQuery(() => useProjectTitles())
    client.setQueryData(["dashboardTasks"], [{ projectTitle: "Only in cache" }])

    await waitFor(() => expect(result.current).toContain("From the database"))
    // The cached title is merged in on the next read of the query.
    const second = renderHookWithQuery(() => useProjectTitles(), { client })
    await waitFor(() => expect(second.result.current.length).toBeGreaterThan(0))

    expect(second.result.current).toContain("From the database")
  })

  it("does not fetch while disabled", () => {
    task({ project_title: "Network refresh" })

    const { result } = renderHookWithQuery(() => useProjectTitles(null, false))

    expect(result.current).toEqual([])
  })

  it("returns an empty list when nothing has a project title", async () => {
    task({ project_title: null })

    const { result } = renderHookWithQuery(() => useProjectTitles())
    await waitFor(() => expect(result.current).toEqual([]))
  })
})
