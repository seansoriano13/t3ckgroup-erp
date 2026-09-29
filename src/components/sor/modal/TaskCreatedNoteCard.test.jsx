import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import TaskCreatedNoteCard from "./TaskCreatedNoteCard"
import { taskService } from "../../../services/taskService"
import { groupTaskService } from "../../../services/groupTaskService"

const renderCard = (ui) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>)

vi.mock("../../../services/taskService", () => ({
  taskService: { getTaskById: vi.fn() },
}))
vi.mock("../../../services/groupTaskService", () => ({
  groupTaskService: { getGroupTaskById: vi.fn() },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const FALLBACK_CONTENT = 'Task "Confirm delivery address" created on entering Stage: Qualified.'

function noteWithTaskId(overrides = {}) {
  return {
    id: "n1",
    content: FALLBACK_CONTENT,
    metadata: { event: "STAGE_ACTION_TASK_CREATED", taskId: "task-1", ...overrides },
  }
}

function noteWithGroupTaskId(overrides = {}) {
  return {
    id: "n2",
    content: 'Group Task "Prepare BOQ" created on entering Stage: Qualified.',
    metadata: { event: "STAGE_ACTION_TASK_CREATED", groupTaskId: "gtask-1", ...overrides },
  }
}

describe("TaskCreatedNoteCard", () => {
  it("refreshes its status when the task's modal invalidates the shared cache", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const base = { id: "task-1", projectTitle: "Confirm delivery address", loggedByName: "Ana" }
    taskService.getTaskById.mockResolvedValueOnce({ ...base, status: "INCOMPLETE" })
    render(
      <QueryClientProvider client={client}>
        <TaskCreatedNoteCard note={noteWithTaskId()} />
      </QueryClientProvider>,
    )
    await screen.findByText("INCOMPLETE")

    taskService.getTaskById.mockResolvedValueOnce({ ...base, status: "COMPLETED" })
    await client.invalidateQueries({ queryKey: ["globalTask"] })

    await screen.findByText("COMPLETED")
  })

  it("shows a closed-off task as Cancelled, not Deleted", async () => {
    taskService.getTaskById.mockResolvedValue({
      id: "task-1",
      projectTitle: "Confirm delivery address",
      status: "DELETED",
      cancelReason: "Cancelled: superseded by a fresh start.",
    })
    renderCard(<TaskCreatedNoteCard note={noteWithTaskId()} />)

    await screen.findByText("CANCELLED")
  })

  it("renders a task card with live title, status, avatar and due date, and opens the task on click", async () => {
    taskService.getTaskById.mockResolvedValue({
      id: "task-1",
      projectTitle: "Confirm delivery address",
      taskDescription: "Call the client",
      status: "INCOMPLETE",
      endAt: "2026-03-05T00:00:00Z",
      loggedByName: "Ana",
      loggedByAvatar: null,
    })

    const handler = vi.fn()
    window.addEventListener("OPEN_ENTITY_DETAILS", handler)

    renderCard(<TaskCreatedNoteCard note={noteWithTaskId()} />)

    await waitFor(() => expect(screen.getByText("Confirm delivery address")).toBeInTheDocument())
    expect(screen.getByText("INCOMPLETE")).toBeInTheDocument()
    expect(screen.getByText("Mar 5")).toBeInTheDocument()

    fireEvent.click(screen.getByText("Confirm delivery address"))
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].detail).toEqual({ id: "task-1", type: "TASK" })

    window.removeEventListener("OPEN_ENTITY_DETAILS", handler)
  })

  it("renders a group task card with member avatars and opens the group task on click", async () => {
    groupTaskService.getGroupTaskById.mockResolvedValue({
      id: "gtask-1",
      title: "Prepare BOQ",
      status: "ACTIVE",
      due_date: "2026-03-10T00:00:00Z",
      members: [
        { id: "m1", employee: { name: "Ben", avatar_path: null } },
        { id: "m2", employee: { name: "Cara", avatar_path: null } },
      ],
    })

    const handler = vi.fn()
    window.addEventListener("OPEN_ENTITY_DETAILS", handler)

    renderCard(<TaskCreatedNoteCard note={noteWithGroupTaskId()} />)

    await waitFor(() => expect(screen.getByText("Prepare BOQ")).toBeInTheDocument())
    fireEvent.click(screen.getByText("Prepare BOQ"))
    expect(handler.mock.calls[0][0].detail).toEqual({ id: "gtask-1", type: "GROUP_TASK" })

    window.removeEventListener("OPEN_ENTITY_DETAILS", handler)
  })

  it("shows Held for a task currently on hold, not its stale metadata status", async () => {
    taskService.getTaskById.mockResolvedValue({
      id: "task-1",
      projectTitle: "Confirm delivery address",
      status: "ON_HOLD",
      endAt: null,
      loggedByName: "Ana",
      loggedByAvatar: null,
    })

    renderCard(<TaskCreatedNoteCard note={noteWithTaskId()} />)

    await waitFor(() => expect(screen.getByText("Held")).toBeInTheDocument())
    expect(screen.queryByText("ON_HOLD")).not.toBeInTheDocument()
  })

  it("falls back to plain text when the note has no task id", () => {
    const note = { id: "n3", content: "Some plain system note.", metadata: { event: "STAGE_ACTION_TASK_CREATED" } }
    renderCard(<TaskCreatedNoteCard note={note} />)
    expect(screen.getByText("Some plain system note.")).toBeInTheDocument()
  })

  it("falls back to plain text when the task fetch fails (permission denied / not found)", async () => {
    taskService.getTaskById.mockRejectedValue(new Error("not found"))
    renderCard(<TaskCreatedNoteCard note={noteWithTaskId()} />)
    await waitFor(() => expect(screen.getByText(FALLBACK_CONTENT)).toBeInTheDocument())
  })

  it("falls back to plain text when the task fetch resolves null", async () => {
    taskService.getTaskById.mockResolvedValue(null)
    renderCard(<TaskCreatedNoteCard note={noteWithTaskId()} />)
    await waitFor(() => expect(screen.getByText(FALLBACK_CONTENT)).toBeInTheDocument())
  })
})
