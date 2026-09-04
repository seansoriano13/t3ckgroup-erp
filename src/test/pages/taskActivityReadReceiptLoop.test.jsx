import { screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"

import TaskActivityTimeline from "@/components/TaskActivityTimeline.jsx"
import { activeChatService } from "@/services/tasks/activeChatService"
import { renderWithProviders } from "@/test/support"
import { waitForNetworkIdle } from "@/test/network"
import { db } from "@/test/db/store"
import { makeCategory, makeEmployee, makeTask } from "@/test/factories"

/**
 * Guards the read-receipt auto-bump against re-entering itself.
 *
 * The effect that bumps `chat_read_receipts` used to depend on the derived
 * `comments` array and on the whole `useMutation` object, both of which are new
 * references on every render. So each run upserted a receipt, the upsert
 * settled the mutation, the new mutation object re-ran the effect, and the
 * component upserted again — forever. In the browser the realtime listener on
 * the same table amplified it into a matching flood of GETs, and the tab ran
 * out of sockets (ERR_INSUFFICIENT_RESOURCES), which made unrelated writes
 * elsewhere in the app fail with a generic error.
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
  const task = makeTask({
    logged_by: owner.id,
    category_id: category.category_id,
    task_description: "Replace the office switch",
  })
  return { owner, task }
}

describe("TaskActivityTimeline — read receipts", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("marks the thread read once for an empty thread, not once per render", async () => {
    const { task } = seedTask()
    const markAsRead = vi.spyOn(activeChatService, "markAsRead")

    renderWithProviders(<TaskActivityTimeline taskId={task.id} entityType="TASK" />)

    await waitFor(() => expect(markAsRead).toHaveBeenCalled())
    await waitForNetworkIdle()

    expect(markAsRead).toHaveBeenCalledTimes(1)
  })

  it("marks the thread read once when comments are present", async () => {
    const { owner, task } = seedTask()
    db.seed("task_activity", [
      {
        task_id: task.id,
        author_id: owner.id,
        type: "COMMENT",
        content: "Switch swapped, please confirm",
        created_at: "2026-09-01T08:00:00.000Z",
      },
    ])
    const markAsRead = vi.spyOn(activeChatService, "markAsRead")

    renderWithProviders(<TaskActivityTimeline taskId={task.id} entityType="TASK" />)

    expect(await screen.findByText("Switch swapped, please confirm")).toBeInTheDocument()
    await waitForNetworkIdle()

    expect(markAsRead).toHaveBeenCalledTimes(1)
  })
})
