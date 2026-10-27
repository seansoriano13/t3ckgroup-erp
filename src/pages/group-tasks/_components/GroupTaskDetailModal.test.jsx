/**
 * Read-only gating for a cancelled group task (#396).
 *
 * A group task's own lifecycle can be CANCELLED (see groupTaskService.js), a
 * raw status value not modeled by GROUP_TASK_STATUS but written straight to
 * `committee_tasks.status`. Cancelled must open fully readable — including
 * chat — but no member can be ticked, no member added/edited/removed, and no
 * task-level edit or delete may happen.
 *
 * ChecklistTaskRenderer and GroupTaskMemberPanel are stubbed to small probes
 * so assertions read the `disabled`/visibility seam this ticket touches
 * rather than re-testing those components' own internals.
 */
import { screen, within } from "@testing-library/react"
import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderWithProviders } from "@/test/support"
import GroupTaskDetailModal from "./GroupTaskDetailModal"

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "creator-1", name: "Creator" } }),
}))

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      upsert: vi.fn(async () => ({ data: null, error: null })),
    })),
    channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
    removeChannel: vi.fn(),
  },
}))

vi.mock("@/services/groupTaskActivityService", () => ({
  groupTaskActivityService: {
    getActivityForTask: vi.fn(async () => []),
    addComment: vi.fn(async () => ({})),
    subscribeToActivity: vi.fn(() => ({})),
    unsubscribeFromActivity: vi.fn(),
  },
}))

vi.mock("@/services/groupTaskService", () => ({
  groupTaskService: {
    getGroupTaskHistory: vi.fn(async () => []),
    updateMemberChecklist: vi.fn(async () => ({})),
  },
}))

vi.mock("@/services/groupRoleService", () => ({
  groupRoleService: { getRoles: vi.fn(async () => []) },
}))

vi.mock("@/services/groupTaskTemplateService", () => ({
  groupTaskTemplateService: { createTemplate: vi.fn(async () => ({})) },
}))

vi.mock("@/hooks/useEmployeeAvatarMap", () => ({
  useEmployeeAvatarMap: () => new Map(),
}))

vi.mock("react-hot-toast", () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() }),
}))

vi.mock("./GroupRoleManagerModal", () => ({ default: () => null }))
vi.mock("./SaveGroupTaskTemplateModal", () => ({ default: () => null }))
vi.mock("@/components/HistoryTimeline", () => ({ default: () => <div>HistoryTimeline</div> }))
vi.mock("@/components/sor/SorLink", () => ({ default: () => null }))

vi.mock("./GroupTaskMemberPanel", () => ({
  default: ({ canEditAssignment }) => (
    <div>GroupTaskMemberPanel canEditAssignment:{String(canEditAssignment)}</div>
  ),
}))

vi.mock("@/components/ChecklistTaskRenderer", () => ({
  default: ({ disabled }) => <div>ChecklistTaskRenderer disabled:{String(disabled)}</div>,
}))

const creator = { id: "creator-1", name: "Creator" }

const member = (overrides = {}) => ({
  id: "member-1",
  employee_id: "creator-1",
  employee: { name: "Creator" },
  status: "PENDING",
  task_description: "Do the sub-task",
  checklist: [{ text: "Step 1", checked: false }],
  attachments: [],
  ...overrides,
})

const task = (overrides = {}) => ({
  id: "gtask-1",
  title: "Quarterly Audit",
  description: "Audit everything",
  created_by: "creator-1",
  creator: { name: "Creator" },
  status: "ACTIVE",
  members: [member()],
  ...overrides,
})

function renderModal(props = {}) {
  return renderWithProviders(
    <GroupTaskDetailModal
      isOpen
      onClose={vi.fn()}
      task={task()}
      currentUserId={creator.id}
      onDelete={vi.fn()}
      onUpdateTask={vi.fn()}
      isSuperAdmin={false}
      isHr={false}
      employees={[creator]}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("GroupTaskDetailModal read-only gating", () => {
  it("still lets a cancelled group task's chat launcher work", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.getByTitle("Open Conversation in Chat Modal")).toBeInTheDocument()
  })

  it("shows a banner explaining the task is cancelled", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.getAllByText(/cancelled/i).length).toBeGreaterThan(0)
  })

  it("says why a cancelled group task was cancelled", () => {
    renderModal({ task: task({ status: "CANCELLED", cancel_reason: "Cancelled: superseded by a fresh start." }) })

    expect(screen.getByText(/superseded by a fresh start/)).toBeInTheDocument()
  })

  it("dates a held group task from when it was held", () => {
    renderModal({ task: task({ status: "ON_HOLD", held_at: "2026-09-03T02:00:00Z" }) })

    expect(screen.getByText(/Held since Sep 3/)).toBeInTheDocument()
  })

  it("disables ticking a member's checklist on a cancelled task", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.getByText("ChecklistTaskRenderer disabled:true")).toBeInTheDocument()
  })

  it("hides Add Member on a cancelled task even for the creator", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.queryByText("Add member")).not.toBeInTheDocument()
  })

  it("hides Edit/Remove Member controls on a cancelled task even for the creator", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.queryByTitle("Edit Assignment")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Remove Member")).not.toBeInTheDocument()
  })

  it("hides the Delete Task button on a cancelled task for the creator", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.queryByTitle("Delete Task")).not.toBeInTheDocument()
  })

  it("hides the Edit Task button on a cancelled task for the creator", () => {
    renderModal({ task: task({ status: "CANCELLED" }) })

    expect(screen.queryByTitle("Edit Task")).not.toBeInTheDocument()
  })

  it("leaves an ACTIVE group task fully interactive for the creator (regression guard)", () => {
    renderModal({ task: task({ status: "ACTIVE" }), canManage: true })

    expect(screen.getByText("ChecklistTaskRenderer disabled:false")).toBeInTheDocument()
    expect(screen.getByText("Add member")).toBeInTheDocument()
    expect(screen.getByTitle("Delete Task")).toBeInTheDocument()
    expect(screen.getByTitle("Edit Task")).toBeInTheDocument()
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument()
  })

  it("hides edit, add-member and delete controls from a non-manager creator (#656)", () => {
    renderModal({ task: task({ status: "ACTIVE" }) })

    expect(screen.queryByText("Add member")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Delete Task")).not.toBeInTheDocument()
    expect(screen.queryByTitle("Edit Task")).not.toBeInTheDocument()
  })
})

describe("GroupTaskDetailModal who can rate", () => {
  it("lets the creator rate a task that has no evaluator", () => {
    renderModal({ task: task({ evaluator_id: null }) })

    expect(screen.getByTitle("Rate")).toBeInTheDocument()
  })

  it("hands rating to the evaluator, not the creator, on a Stage Action task", () => {
    renderModal({ task: task({ evaluator_id: "deal-owner-1" }) })

    expect(screen.queryByTitle("Rate")).not.toBeInTheDocument()
  })

  it("shows the Rate button to the evaluator", () => {
    renderModal({
      task: task({ evaluator_id: "deal-owner-1" }),
      currentUserId: "deal-owner-1",
    })

    expect(screen.getByTitle("Rate")).toBeInTheDocument()
  })
})

describe("GroupTaskDetailModal awaiting evaluation", () => {
  it("lets the evaluator rate a task that is waiting for them", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION" }) })

    expect(screen.getByTitle("Rate")).toBeInTheDocument()
  })

  it("names the status on the badge", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION" }) })

    expect(screen.getByText("AWAITING EVALUATION")).toBeInTheDocument()
  })

  it("offers Resubmit when HR sent a waiting task back", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION", hr_remarks: "Recount aisle B" }) })

    expect(screen.getByTitle("Resubmit")).toBeInTheDocument()
  })

  it("lets the creator send an active task to evaluation by hand", () => {
    const onSendToEvaluation = vi.fn()
    renderModal({ task: task(), onSendToEvaluation })

    screen.getByRole("button", { name: "Send to evaluation" }).click()

    expect(onSendToEvaluation).toHaveBeenCalled()
  })

  it("does not offer it once the task is already waiting", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION" }), onSendToEvaluation: vi.fn() })

    expect(screen.queryByRole("button", { name: "Send to evaluation" })).not.toBeInTheDocument()
  })

  it("does not offer it to someone who only works on the task", () => {
    renderModal({
      task: task({ created_by: "someone-else", evaluator_id: "deal-owner-1" }),
      onSendToEvaluation: vi.fn(),
    })

    expect(screen.queryByRole("button", { name: "Send to evaluation" })).not.toBeInTheDocument()
  })
})

describe("GroupTaskDetailModal who evaluates", () => {
  const evaluatorRow = () => screen.getByText("Evaluated by").parentElement
  const people = [
    { id: "creator-1", name: "Creator" },
    { id: "deal-owner-1", name: "Deal Owner Dan" },
  ]

  it("names the evaluator at the top", () => {
    renderModal({
      task: task({ evaluator_id: "deal-owner-1", evaluator: { name: "Deal Owner Dan" } }),
      employees: people,
      isHead: false,
      onChangeEvaluator: undefined,
    })

    expect(screen.getByText("Evaluated by")).toBeInTheDocument()
    expect(screen.getByText("Deal Owner Dan")).toBeInTheDocument()
  })

  it("names the creator as the evaluator when the task has none", () => {
    renderModal({ task: task({ evaluator_id: null }), onChangeEvaluator: undefined })

    expect(screen.getByText("Evaluated by").nextSibling).toHaveTextContent("Creator")
  })

  it("lets the creator change the evaluator", () => {
    renderModal({ task: task({ evaluator_id: null }), employees: people, onChangeEvaluator: vi.fn() })

    expect(within(evaluatorRow()).getByRole("button")).toBeInTheDocument()
  })

  it("lets a head, who did not create the task, change the evaluator", () => {
    renderModal({
      task: task({ evaluator_id: null }),
      currentUserId: "head-1",
      isHead: true,
      employees: people,
      onChangeEvaluator: vi.fn(),
    })

    expect(within(evaluatorRow()).getByRole("button")).toBeInTheDocument()
  })

  it("does not let an ordinary member change the evaluator", () => {
    renderModal({
      task: task({ evaluator_id: null }),
      currentUserId: "member-9",
      isHead: false,
      employees: people,
      onChangeEvaluator: vi.fn(),
    })

    expect(within(evaluatorRow()).queryByRole("button")).not.toBeInTheDocument()
    expect(screen.getByText("Evaluated by").nextSibling).toHaveTextContent("Creator")
  })
})

describe("GroupTaskDetailModal who can rate", () => {
  it("lets the creator rate a task that has no evaluator", () => {
    renderModal({ task: task({ evaluator_id: null }) })

    expect(screen.getByTitle("Rate")).toBeInTheDocument()
  })

  it("hands rating to the evaluator, not the creator, on a Stage Action task", () => {
    renderModal({ task: task({ evaluator_id: "deal-owner-1" }) })

    expect(screen.queryByTitle("Rate")).not.toBeInTheDocument()
  })

  it("shows the Rate button to the evaluator", () => {
    renderModal({
      task: task({ evaluator_id: "deal-owner-1" }),
      currentUserId: "deal-owner-1",
    })

    expect(screen.getByTitle("Rate")).toBeInTheDocument()
  })
})

describe("GroupTaskDetailModal awaiting evaluation", () => {
  it("lets the evaluator rate a task that is waiting for them", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION" }) })

    expect(screen.getByTitle("Rate")).toBeInTheDocument()
  })

  it("names the status on the badge", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION" }) })

    expect(screen.getByText("AWAITING EVALUATION")).toBeInTheDocument()
  })

  it("offers Resubmit when HR sent a waiting task back", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION", hr_remarks: "Recount aisle B" }) })

    expect(screen.getByTitle("Resubmit")).toBeInTheDocument()
  })

  it("lets the creator send an active task to evaluation by hand", () => {
    const onSendToEvaluation = vi.fn()
    renderModal({ task: task(), onSendToEvaluation })

    screen.getByRole("button", { name: "Send to evaluation" }).click()

    expect(onSendToEvaluation).toHaveBeenCalled()
  })

  it("does not offer it once the task is already waiting", () => {
    renderModal({ task: task({ status: "AWAITING_EVALUATION" }), onSendToEvaluation: vi.fn() })

    expect(screen.queryByRole("button", { name: "Send to evaluation" })).not.toBeInTheDocument()
  })

  it("does not offer it to someone who only works on the task", () => {
    renderModal({
      task: task({ created_by: "someone-else", evaluator_id: "deal-owner-1" }),
      onSendToEvaluation: vi.fn(),
    })

    expect(screen.queryByRole("button", { name: "Send to evaluation" })).not.toBeInTheDocument()
  })
})

describe("GroupTaskDetailModal who evaluates", () => {
  const evaluatorRow = () => screen.getByText("Evaluated by").parentElement
  const people = [
    { id: "creator-1", name: "Creator" },
    { id: "deal-owner-1", name: "Deal Owner Dan" },
  ]

  it("names the evaluator at the top", () => {
    renderModal({
      task: task({ evaluator_id: "deal-owner-1", evaluator: { name: "Deal Owner Dan" } }),
      employees: people,
      isHead: false,
      onChangeEvaluator: undefined,
    })

    expect(screen.getByText("Evaluated by")).toBeInTheDocument()
    expect(screen.getByText("Deal Owner Dan")).toBeInTheDocument()
  })

  it("names the creator as the evaluator when the task has none", () => {
    renderModal({ task: task({ evaluator_id: null }), onChangeEvaluator: undefined })

    expect(screen.getByText("Evaluated by").nextSibling).toHaveTextContent("Creator")
  })

  it("lets the creator change the evaluator", () => {
    renderModal({ task: task({ evaluator_id: null }), employees: people, onChangeEvaluator: vi.fn() })

    expect(within(evaluatorRow()).getByRole("button")).toBeInTheDocument()
  })

  it("lets a head, who did not create the task, change the evaluator", () => {
    renderModal({
      task: task({ evaluator_id: null }),
      currentUserId: "head-1",
      isHead: true,
      employees: people,
      onChangeEvaluator: vi.fn(),
    })

    expect(within(evaluatorRow()).getByRole("button")).toBeInTheDocument()
  })

  it("does not let an ordinary member change the evaluator", () => {
    renderModal({
      task: task({ evaluator_id: null }),
      currentUserId: "member-9",
      isHead: false,
      employees: people,
      onChangeEvaluator: vi.fn(),
    })

    expect(within(evaluatorRow()).queryByRole("button")).not.toBeInTheDocument()
    expect(screen.getByText("Evaluated by").nextSibling).toHaveTextContent("Creator")
  })
})
