/**
 * Read-only gating for a held/cancelled individual task (#396).
 *
 * A task ON_HOLD or CANCELLED must open fully readable — including its chat —
 * but nothing on it may be mutated: no entering edit mode, no approve/reject,
 * no HR verify, no delete. Child sections are stubbed to lightweight probes so
 * these tests assert on the *props/permissions* TaskDetails hands down rather
 * than on any one section's internal markup, which is the seam this ticket
 * actually touches.
 */
import { act, screen } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderWithProviders, setupUser } from "../test/support"
import TaskDetails from "./TaskDetails"
import { TASK_STATUS } from "../constants/status.js"

const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

vi.mock("../hooks/useTaskTopology", () => ({
  useTaskTopology: () => ({ filteredCategories: [], isLoadingTop: false }),
}))

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null })),
    })),
  },
}))

vi.mock("@/services/tasks/taskQueryService", () => ({
  taskQueryService: { getTaskById: vi.fn(async () => null) },
}))

vi.mock("@/services/purchasingService", () => ({
  purchasingService: { listForTask: vi.fn(async () => []) },
}))

vi.mock("../services/tasks/activeChatService", () => ({
  activeChatService: { markAsRead: vi.fn() },
}))

vi.mock("react-hot-toast", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  }),
}))

// Every heavy section is replaced with a tiny probe that surfaces the props
// this ticket cares about, so assertions read from the DOM like any other
// component test instead of reaching into TaskDetails internals.
vi.mock("./ManagementSection", () => ({ default: () => <div>ManagementSection</div> }))
vi.mock("./StandardDetailsSection", () => ({ default: () => <div>StandardDetailsSection</div> }))
vi.mock("./TaskBodySection", () => ({
  default: ({ canEdit }) => <div>TaskBodySection canEdit:{String(canEdit)}</div>,
}))
vi.mock("./ProcurementResolutionPanel", () => ({ default: () => null }))
vi.mock("./TaskEvaluationSection", () => ({ default: () => <div>TaskEvaluationSection</div> }))
vi.mock("./TaskActivityTimeline", () => ({
  default: ({ taskId }) => <div>TaskActivityTimeline for {taskId}</div>,
}))
vi.mock("./TaskHeader", () => ({ default: () => <div>TaskHeader</div> }))
vi.mock("./TaskFooter.jsx", () => ({
  default: ({ actions, permissions, state }) => (
    <div>
      <button onClick={actions.onToggleEdit}>toggle-edit</button>
      <button onClick={actions.onDelete}>delete</button>
      <span>canEdit:{String(permissions.canEdit)}</span>
      <span>canEvaluate:{String(permissions.canEvaluate)}</span>
      <span>isHr:{String(permissions.isHr)}</span>
      <span>isManagement:{String(permissions.isManagement)}</span>
      <span>hasUncheckedItems:{String(state.hasUncheckedItems)}</span>
    </div>
  ),
}))

const head = { id: "head-1", name: "Head Ito", is_head: true }
const hr = { id: "hr-1", name: "HR Rios", is_hr: true }

const task = (overrides = {}) => ({
  id: "task-1",
  loggedById: "emp-1",
  status: TASK_STATUS.INCOMPLETE,
  taskDescription: "Do the thing",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

function renderModal({ as = head, ...props } = {}) {
  mockUser.current = as
  const onUpdateTask = vi.fn()
  const onDeleteTask = vi.fn()
  const result = renderWithProviders(
    <TaskDetails
      isOpen
      onClose={vi.fn()}
      task={task()}
      onUpdateTask={onUpdateTask}
      onDeleteTask={onDeleteTask}
      {...props}
    />,
  )
  return { ...result, onUpdateTask, onDeleteTask }
}

beforeEach(() => {
  mockUser.current = null
})

describe("TaskDetails read-only gating", () => {
  it("still shows the chat timeline for a held task", () => {
    renderModal({ task: task({ status: TASK_STATUS.ON_HOLD }) })

    expect(screen.getByText("TaskActivityTimeline for task-1")).toBeInTheDocument()
  })

  it("blocks editing on a held task", () => {
    renderModal({ as: head, task: task({ status: TASK_STATUS.ON_HOLD }) })

    expect(screen.getByText("canEdit:false")).toBeInTheDocument()
    expect(screen.getByText("TaskBodySection canEdit:false")).toBeInTheDocument()
  })

  it("blocks head evaluation on a held task", () => {
    renderModal({ as: head, task: task({ status: TASK_STATUS.ON_HOLD }) })

    expect(screen.getByText("canEvaluate:false")).toBeInTheDocument()
  })

  it("hides HR verify/delete affordances on a held task", () => {
    renderModal({ as: hr, task: task({ status: TASK_STATUS.ON_HOLD }) })

    expect(screen.getByText("isHr:false")).toBeInTheDocument()
    expect(screen.getByText("isManagement:false")).toBeInTheDocument()
  })

  it("blocks editing on a cancelled task", () => {
    renderModal({ as: head, task: task({ status: TASK_STATUS.CANCELLED }) })

    expect(screen.getByText("canEdit:false")).toBeInTheDocument()
    expect(screen.getByText("canEvaluate:false")).toBeInTheDocument()
  })

  it("shows a banner explaining why a held task is locked", () => {
    renderModal({ task: task({ status: TASK_STATUS.ON_HOLD }) })

    expect(screen.getByText(/held/i)).toBeInTheDocument()
  })

  it("shows a banner explaining why a cancelled task is locked", () => {
    renderModal({ task: task({ status: TASK_STATUS.CANCELLED }) })

    expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0)
  })

  it("does not run the update handler if edit toggle is somehow clicked while held", async () => {
    const { onUpdateTask } = renderModal({ as: head, task: task({ status: TASK_STATUS.ON_HOLD }) })

    await setupUser().click(screen.getByText("toggle-edit"))
    await setupUser().click(screen.getByText("delete"))

    expect(onUpdateTask).not.toHaveBeenCalled()
  })

  it("dates a held task from when it was held, not when it was last edited", () => {
    renderModal({
      task: task({ status: TASK_STATUS.ON_HOLD, heldAt: "2026-09-03T02:00:00Z", editedAt: "2026-01-15T02:00:00Z" }),
    })

    expect(screen.getByText(/Held since Sep 3/)).toBeInTheDocument()
  })

  it("opens a closed-off task read-only, saying why — stored DELETED with a cancel reason", () => {
    renderModal({
      as: head,
      task: task({ status: TASK_STATUS.DELETED, cancelReason: "Cancelled: the Revert out of Proposal removed its progress." }),
    })

    expect(screen.getByText("canEdit:false")).toBeInTheDocument()
    expect(screen.getByText("canEvaluate:false")).toBeInTheDocument()
    expect(screen.getByText(/the Revert out of Proposal removed its progress/)).toBeInTheDocument()
    expect(screen.queryByText("Task Deleted")).not.toBeInTheDocument()
  })

  it("leaves an ordinary INCOMPLETE task fully editable (regression guard)", () => {
    renderModal({ as: head, task: task({ status: TASK_STATUS.INCOMPLETE }) })

    expect(screen.getByText("canEdit:true")).toBeInTheDocument()
    expect(screen.getByText("canEvaluate:true")).toBeInTheDocument()
    expect(screen.queryByText(/held/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument()
  })
})

// The form hydrates from the task in a microtask; flush it so assertions read
// the hydrated state, not the empty initial one (which is trivially "no unchecked items").
const hydrated = () => act(async () => { await Promise.resolve() })

describe("TaskDetails checklist gating", () => {
  const grouped = (checked) => [
    { id: "g1", title: "Checking", items: [{ text: "A", checked }, { text: "B", checked }] },
    { id: "g2", title: "Release", items: [{ text: "C", checked }] },
  ]

  it("does not block submit/approve when every item in a phased checklist is ticked", async () => {
    renderModal({ as: head, task: task({ checklist: grouped(true) }) })
    await hydrated()

    expect(screen.getByText("hasUncheckedItems:false")).toBeInTheDocument()
  })

  it("still blocks when a phased checklist has an unticked item", async () => {
    const list = grouped(true)
    list[1].items[0].checked = false
    renderModal({ as: head, task: task({ checklist: list }) })
    await hydrated()

    expect(screen.getByText("hasUncheckedItems:true")).toBeInTheDocument()
  })

  it("keeps blocking a flat checklist with an unticked item", async () => {
    renderModal({ as: head, task: task({ checklist: [{ text: "A", checked: true }, { text: "B", checked: false }] }) })
    await hydrated()

    expect(screen.getByText("hasUncheckedItems:true")).toBeInTheDocument()
  })
})
