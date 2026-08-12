import { describe, expect, it } from "vitest"
import { taskService } from "./taskService"
import { taskActivityService } from "./tasks/taskActivityService"
import { taskMutationService } from "./tasks/taskMutationService"
import { taskQueryService } from "./tasks/taskQueryService"

/**
 * `taskService` is the flat façade older screens still import. It has to keep
 * exposing everything the three task services do — a method dropped here breaks
 * a caller silently, with `undefined is not a function` at runtime rather than
 * at build time.
 */
describe("taskService façade", () => {
  it.each([
    ["query", taskQueryService],
    ["mutation", taskMutationService],
    ["activity", taskActivityService],
  ])("exposes every %s method", (_label, source) => {
    for (const name of Object.keys(source)) {
      expect(typeof taskService[name]).toBe(typeof source[name])
    }
  })

  it("adds nothing of its own beyond the three services", () => {
    const composed = new Set([
      ...Object.keys(taskQueryService),
      ...Object.keys(taskMutationService),
      ...Object.keys(taskActivityService),
    ])

    expect(Object.keys(taskService).filter((k) => !composed.has(k))).toEqual([])
  })

  it("has no name collisions that would shadow one service with another", () => {
    const names = [
      ...Object.keys(taskQueryService),
      ...Object.keys(taskMutationService),
      ...Object.keys(taskActivityService),
    ]

    expect(names.length).toBe(new Set(names).size)
  })
})
