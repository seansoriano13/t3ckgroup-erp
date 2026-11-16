import { useState } from "react"
import toast from "react-hot-toast"
import { Check, ClipboardCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/Tooltip"
import EvaluationTabs, { AWAITING_EVALUATION_FILTER } from "@/pages/group-tasks/_components/EvaluationTabs"
import GroupTaskTableView from "@/pages/group-tasks/_components/GroupTaskTableView"
import { ApprovalTable } from "@/pages/approvals/_components/ApprovalTable"
import { taskToItem } from "@/utils/approvalItems"
import { TASK_STATUS } from "@/constants/status"
import { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { PEOPLE, daysAgo, hoursAgo, inDays } from "./sampleData"

/**
 * The Tasks tab's samples: the app's own components fed Sample Data.
 * Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

const noop = () => {}
const blocked = () => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })

const member = (person, status) => ({ employee_id: person.id, employee: { name: person.name }, status })

const groupTask = (id, title, status, { due, members, creator = PEOPLE.lara, created = 10 } = {}) => ({
  id,
  title,
  description: null,
  status,
  created_by: creator.id,
  creator: { name: creator.name },
  created_at: daysAgo(created),
  due_date: due ?? null,
  members,
})

const EVALUATION_TASKS = [
  groupTask("gt-1", "Demo Province bid documents", "AWAITING_EVALUATION", {
    due: daysAgo(1),
    members: [member(PEOPLE.paolo, "DONE"), member(PEOPLE.joy, "DONE"), member(PEOPLE.carlo, "DONE")],
    created: 12,
  }),
  groupTask("gt-2", "Demo City Hall site survey", "AWAITING_EVALUATION", {
    due: daysAgo(3),
    members: [member(PEOPLE.mark, "DONE"), member(PEOPLE.carlo, "DONE")],
    created: 9,
  }),
]

const ACTIVE_TASKS = [
  groupTask("gt-3", "Demo School Laptops delivery plan", "ACTIVE", {
    due: inDays(6),
    members: [member(PEOPLE.paolo, "DONE"), member(PEOPLE.joy, "PENDING"), member(PEOPLE.mark, "PENDING")],
  }),
  groupTask("gt-4", "Demo Clinic quotation", "ACTIVE", {
    due: new Date(Date.now() + 5 * 3600000).toISOString(),
    members: [member(PEOPLE.lara, "DONE"), member(PEOPLE.carlo, "PENDING")],
  }),
  groupTask("gt-5", "Demo Port radios checklist", "ACTIVE", {
    due: daysAgo(2),
    members: [member(PEOPLE.mark, "PENDING"), member(PEOPLE.joy, "PENDING")],
  }),
]

export function GroupTaskEvaluationSample() {
  const [filter, setFilter] = useState(AWAITING_EVALUATION_FILTER)
  const tasks = filter === AWAITING_EVALUATION_FILTER ? EVALUATION_TASKS : filter === "ALL" ? [...EVALUATION_TASKS, ...ACTIVE_TASKS] : []
  return (
    <div>
      <EvaluationTabs statusFilter={filter} count={EVALUATION_TASKS.length} holdCount={0} onChange={setFilter} />
      <GroupTaskTableView tasks={tasks} onView={noop} hasAnyTasks />
    </div>
  )
}

export function GroupTaskDatesSample() {
  return <GroupTaskTableView tasks={ACTIVE_TASKS} onView={noop} hasAnyTasks />
}

const approvalTask = (id, who, desc, { graded, hoursOld }) => ({
  id,
  categoryId: "Sales",
  taskDescription: desc,
  loggedById: who.id,
  loggedByName: who.name,
  subDepartment: who.sub_department,
  createdAt: hoursAgo(hoursOld),
  reportedToName: PEOPLE.mark.name,
  status: graded ? TASK_STATUS.COMPLETE : TASK_STATUS.AWAITING_APPROVAL,
  evaluatedById: graded ? PEOPLE.mark.id : null,
  evaluatedByName: graded ? PEOPLE.mark.name : null,
  evaluatedAt: graded ? hoursAgo(hoursOld - 6) : null,
  grade: graded ? 4 : null,
  hrVerified: false,
})

const APPROVAL_ITEMS = [
  taskToItem(approvalTask("ta-1", PEOPLE.paolo, "Client visit: Demo City Hall", { graded: false, hoursOld: 20 }), "tasks"),
  taskToItem(approvalTask("ta-2", PEOPLE.lara, "Prepared the Demo Province bid", { graded: false, hoursOld: 60 }), "tasks"),
  taskToItem(approvalTask("ta-3", PEOPLE.joy, "Supplier call: Demo Radios", { graded: true, hoursOld: 30 }), "hr"),
]

export function TaskApprovalsSample() {
  return (
    <ApprovalTable
      items={APPROVAL_ITEMS}
      queueIcon={ClipboardCheck}
      onOpen={noop}
      showStage
      keyboard={false}
      renderRowAction={(item) =>
        item.queue === "hr" ? (
          <Tooltip content="Verify & sign">
            <Button variant="outline" size="icon-sm" aria-label={`Verify ${item.title}`} onClick={blocked}>
              <Check size={14} />
            </Button>
          </Tooltip>
        ) : (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={blocked}>
            Grade
          </Button>
        )
      }
    />
  )
}
