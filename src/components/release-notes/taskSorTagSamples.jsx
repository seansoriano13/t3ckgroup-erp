import TaskTableView from "../TaskTableView"
import GroupTaskTableView from "../../pages/group-tasks/_components/GroupTaskTableView"
import SampleProvider from "./SampleProvider"
import { PEOPLE, daysAgo, inDays } from "./sampleData"

/**
 * The SOR tag on task rows, as the real Task and Group Task tables fed Sample
 * Data (ADR 0030). Kept in its own file: the tag is the app's SorLinkChip, and
 * this sample adds nothing to the shared sample files.
 */

const noop = () => {}

const TAG_SOR = { sales_reference: "S-1001", client_name: "Demo Province" }
const TAG_SOR_NO_REF = { sales_reference: null, client_name: "Demo City Hall" }

const task = (id, title, extra = {}) => ({
  id,
  projectTitle: title,
  taskDescription: title,
  categoryName: null,
  status: "INCOMPLETE",
  priority: "MEDIUM",
  loggedById: PEOPLE.lara.id,
  loggedByName: PEOPLE.lara.name,
  department: "SALES",
  subDepartment: "GOVERNMENT",
  targetDate: inDays(3),
  endAt: null,
  opportunityId: null,
  opportunity: null,
  ...extra,
})

const TASKS = [
  task("t-1", "Confirm specs", { opportunityId: "o-1", opportunity: TAG_SOR }),
  task("t-2", "Revised quote", { opportunityId: "o-2", opportunity: TAG_SOR_NO_REF, priority: "HIGH" }),
  task("t-3", "Weekly report"),
]

const groupTask = (id, title, extra = {}) => ({
  id,
  title,
  description: "",
  status: "ACTIVE",
  created_by: PEOPLE.paolo.id,
  creator: { name: PEOPLE.paolo.name },
  created_at: daysAgo(2),
  due_date: inDays(5),
  members: [
    { employee_id: PEOPLE.joy.id, status: "DONE", employee: { name: PEOPLE.joy.name } },
    { employee_id: PEOPLE.carlo.id, status: "PENDING", employee: { name: PEOPLE.carlo.name } },
  ],
  opportunity_id: null,
  opportunity: null,
  ...extra,
})

const GROUP_TASKS = [
  groupTask("g-1", "Bid documents", { opportunity_id: "o-1", opportunity: TAG_SOR }),
  groupTask("g-2", "Site inspection", { opportunity_id: "o-2", opportunity: TAG_SOR_NO_REF }),
  groupTask("g-3", "Inventory count"),
]

const SEED = [[["employeeAvatarMap"], new Map()]]

function Labelled({ label, children }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </div>
  )
}

export function TaskSorTagSample() {
  return (
    <SampleProvider seed={SEED}>
      <div className="space-y-5">
        <Labelled label="Tasks">
          <TaskTableView tasks={TASKS} onView={noop} />
        </Labelled>
        <Labelled label="Group Tasks">
          <GroupTaskTableView tasks={GROUP_TASKS} onView={noop} />
        </Labelled>
      </div>
    </SampleProvider>
  )
}
