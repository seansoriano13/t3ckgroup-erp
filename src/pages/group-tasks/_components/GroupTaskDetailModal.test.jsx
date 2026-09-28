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
import { screen } from "@testing-library/react"
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
    renderModal({ task: task({ status: "ACTIVE" }) })

    expect(screen.getByText("ChecklistTaskRenderer disabled:false")).toBeInTheDocument()
    expect(screen.getByText("Add member")).toBeInTheDocument()
    expect(screen.getByTitle("Delete Task")).toBeInTheDocument()
    expect(screen.getByTitle("Edit Task")).toBeInTheDocument()
    expect(screen.queryByText(/cancelled/i)).not.toBeInTheDocument()
  })
})
