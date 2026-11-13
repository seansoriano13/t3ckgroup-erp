import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"

import TaskActivityTimeline from "@/components/TaskActivityTimeline.jsx"
import { renderWithProviders } from "@/test/support"
import { makeCategory, makeEmployee, makeTask } from "@/test/factories"

/**
 * Guards the Task chat against a full page reload on Send.
 *
 * The composer is a <form onSubmit={handleSend}>, but handleSend never called
 * preventDefault(). Pressing Enter called handleSend directly, so text-only
 * messages looked fine, but clicking Send (the only way to send a picked
 * attachment) let the browser submit the form natively: the page reloaded to
 * "/tasks?" and the attachment was lost.
 *
 * Lives under src/test/pages rather than beside the component because
 * Generouted globs src/pages into the route table.
 */

let authUser
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: authUser }) }))

function seedTask() {
  const category = makeCategory({ category_id: "IT-01" })
  const owner = makeEmployee({ name: "Ana Reyes" })
  authUser = { id: owner.id, is_head: false, is_hr: false, isSuperAdmin: false }
  return makeTask({ logged_by: owner.id, category_id: category.category_id, task_description: "Replace the office switch" })
}

describe("TaskActivityTimeline — Send button", () => {
  let submits
  const record = (e) => submits.push(e.defaultPrevented)

  beforeEach(() => {
    submits = []
    URL.createObjectURL ??= () => "blob:preview"
    URL.revokeObjectURL ??= () => {}
    window.addEventListener("submit", record)
  })
  afterEach(() => window.removeEventListener("submit", record))

  it("does not let the browser submit (reload) the form when Send is clicked with an attachment", async () => {
    const task = seedTask()
    const user = userEvent.setup()
    const { container } = renderWithProviders(<TaskActivityTimeline taskId={task.id} entityType="TASK" />)

    await screen.findByPlaceholderText(/send a message/i)
    const input = container.querySelector('input[type="file"]')
    await user.upload(input, new File(["x"], "photo.png", { type: "image/png" }))

    await user.click(await screen.findByRole("button", { name: /send/i }))

    expect(submits.length).toBeGreaterThan(0)
    expect(submits.every(Boolean)).toBe(true)
  })
})
