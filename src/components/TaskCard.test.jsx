import { screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import TaskCard from "./TaskCard"
import { renderWithProviders, setupUser } from "@/test/support"

/**
 * The card every employee sees on every list. Two behaviours carry real
 * weight: the checklist ticks write straight through to the task (no modal, no
 * confirmation), and who is allowed to tick them depends on ownership and
 * pipeline state — a task already submitted for approval must not keep moving
 * underneath the head reviewing it.
 *
 * AuthContext is replaced with a stub so a card can be rendered as any role;
 * the provider itself is covered in src/context/AuthContext.test.jsx.
 */
const mockUser = vi.hoisted(() => ({ current: null }))

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser.current }),
}))

const task = (overrides = {}) => ({
  id: "task-1",
  taskDescription: "Replace the office switch",
  projectTitle: null,
  categoryId: "IT-01",
  categoryDesc: "Support",
  loggedById: "emp-1",
  loggedByName: "Ana Reyes",
  reportedTo: null,
  reportedToName: null,
  status: "INCOMPLETE",
  priority: "LOW",
  hrVerified: false,
  grade: 0,
  remarks: "",
  attachments: [],
  startAt: "2026-03-05T02:00:00Z",
  endAt: null,
  createdAt: "2026-03-05T02:00:00Z",
  ...overrides,
})

const owner = { id: "emp-1", name: "Ana Reyes" }
const head = { id: "head-1", name: "Head Ito", is_head: true }
const colleague = { id: "emp-2", name: "Ben Cruz" }

function renderCard({ as = owner, ...props } = {}) {
  mockUser.current = as
  const onView = vi.fn()
  const onSilentUpdate = vi.fn()
  const result = renderWithProviders(
    <TaskCard task={task()} onView={onView} onSilentUpdate={onSilentUpdate} {...props} />,
  )
  return { ...result, onView, onSilentUpdate }
}

const checklist = (items) => JSON.stringify(items)

describe("TaskCard", () => {
  describe("what it shows", () => {
    it("shows the task description as the title", () => {
      renderCard()

      expect(screen.getByText("Replace the office switch")).toBeInTheDocument()
    })

    it("prefers the project title when there is one", () => {
      renderCard({ task: task({ projectTitle: "Network refresh" }) })

      expect(screen.getByText("Network refresh")).toBeInTheDocument()
    })

    it("splits a multi-line description into a title and a snippet", () => {
      renderCard({ task: task({ taskDescription: "Replace the switch\nOrdered the part" }) })

      expect(screen.getByText("Replace the switch")).toBeInTheDocument()
      expect(screen.getByText("Ordered the part")).toBeInTheDocument()
    })

    it("shows a manager who logged the task", () => {
      renderCard({ as: head })

      expect(screen.getByTitle("Logged by Ana Reyes")).toBeInTheDocument()
    })

    it("spares an employee their own name on their own card", () => {
      renderCard({ as: owner })

      expect(screen.queryByTitle("Logged by Ana Reyes")).not.toBeInTheDocument()
    })

    it("shows the head a task was reported to", () => {
      renderCard({ task: task({ reportedTo: "head-1", reportedToName: "Head Ito" }) })

      expect(screen.getByTitle("Reported to Head Ito")).toBeInTheDocument()
    })

    it("opens the task when the card is clicked", async () => {
      const { onView } = renderCard()

      await setupUser().click(screen.getByText("Replace the office switch"))

      expect(onView).toHaveBeenCalled()
    })
  })

  describe("checklists", () => {
    const twoItems = checklist([
      { text: "Order the part", checked: true },
      { text: "Swap the unit", checked: false },
    ])

    it("shows the checklist items", () => {
      renderCard({ task: task({ taskDescription: twoItems }) })

      expect(screen.getByText("Order the part")).toBeInTheDocument()
      expect(screen.getByText("Swap the unit")).toBeInTheDocument()
    })

    it("shows how many items are done", () => {
      renderCard({ task: task({ taskDescription: twoItems }) })

      expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument()
    })

    it("uses the checklist's own title when it has one", () => {
      const titled = checklist({ title: "Switch replacement", items: [{ text: "Order" }] })

      renderCard({ task: task({ taskDescription: titled }) })

      expect(screen.getByText("Switch replacement")).toBeInTheDocument()
    })

    it("displays the active step and total items for grouped multi-step checklists", () => {
      const grouped = [
        { id: "g1", title: "Phase 1", items: [{ text: "Step 1 Done", checked: true }] },
        { id: "g2", title: "Phase 2", items: [{ text: "Step 2 Todo", checked: false }] },
      ]

      renderCard({ task: task({ checklist: grouped }) })

      expect(screen.getByText(/Step 2\/2 · 1\/2/)).toBeInTheDocument()
    })

    it("accepts a checklist that arrived already parsed", () => {
      renderCard({
        task: task({ taskDescription: [{ text: "Order the part", checked: false }] }),
      })

      expect(screen.getByText("Order the part")).toBeInTheDocument()
    })

    it("shows text that merely looks like JSON as plain text", () => {
      renderCard({ task: task({ taskDescription: "[URGENT] Fix the printer" }) })

      expect(screen.getByText("[URGENT] Fix the printer")).toBeInTheDocument()
    })

    it("collapses the whole list behind a toggle naming the item count", async () => {
      // WIP note: the card currently shows nothing "always visible" — every
      // item, however many, sits behind one collapse/expand toggle.
      const many = checklist([{ text: "First" }, { text: "Second" }, { text: "Third" }])
      renderCard({ task: task({ taskDescription: many }) })

      const toggle = screen.getByRole("button", { name: /3 items/i })

      await setupUser().click(toggle)

      expect(screen.getByRole("button", { name: /see less/i })).toBeInTheDocument()
    })

    it("still shows a toggle for a single-item checklist", () => {
      renderCard({ task: task({ taskDescription: checklist([{ text: "Only one" }]) }) })

      expect(screen.getByRole("button", { name: /^1 item$/i })).toBeInTheDocument()
    })
  })

  describe("ticking an item", () => {
    const items = checklist([
      { text: "Order the part", checked: false },
      { text: "Swap the unit", checked: false },
    ])

    it("saves the change straight away for the owner", async () => {
      // The write always lands on `checklist`, even when the card read the
      // items off the legacy `taskDescription` JSON string — ticking an item
      // migrates that task onto the new field.
      const { onSilentUpdate } = renderCard({ as: owner, task: task({ taskDescription: items }) })

      await setupUser().click(screen.getByText("Order the part"))

      expect(onSilentUpdate).toHaveBeenCalledWith({
        id: "task-1",
        checklist: checklist([
          { text: "Order the part", checked: true },
          { text: "Swap the unit", checked: false },
        ]),
        editedBy: "emp-1",
      })
    })

    it("leaves the other items alone", async () => {
      const partly = checklist([
        { text: "Order the part", checked: true },
        { text: "Swap the unit", checked: false },
      ])
      const { onSilentUpdate } = renderCard({ as: owner, task: task({ taskDescription: partly }) })

      await setupUser().click(screen.getByText("Swap the unit"))

      expect(JSON.parse(onSilentUpdate.mock.calls[0][0].checklist)).toEqual([
        { text: "Order the part", checked: true },
        { text: "Swap the unit", checked: true },
      ])
    })

    it("keeps a parsed checklist parsed rather than stringifying it", async () => {
      const { onSilentUpdate } = renderCard({
        as: owner,
        task: task({ taskDescription: [{ text: "Order the part", checked: false }] }),
      })

      await setupUser().click(screen.getByText("Order the part"))

      expect(onSilentUpdate.mock.calls[0][0].checklist).toEqual([
        { text: "Order the part", checked: true },
      ])
    })

    it("does not let a colleague tick someone else's checklist", async () => {
      const { onSilentUpdate } = renderCard({
        as: colleague,
        task: task({ taskDescription: items }),
      })

      await setupUser().click(screen.getByText("Order the part"))

      expect(onSilentUpdate).not.toHaveBeenCalled()
    })

    it("does not let a head tick an item on somebody else's task", async () => {
      // A head may review the task, but the checklist belongs to its owner.
      const { onSilentUpdate } = renderCard({ as: head, task: task({ taskDescription: items }) })

      await setupUser().click(screen.getByText("Order the part"))

      expect(onSilentUpdate).not.toHaveBeenCalled()
    })

    it("freezes the checklist once the task is awaiting approval", async () => {
      const { onSilentUpdate } = renderCard({
        as: owner,
        task: task({ taskDescription: items, status: "AWAITING APPROVAL" }),
      })

      await setupUser().click(screen.getByText("Order the part"))

      expect(onSilentUpdate).not.toHaveBeenCalled()
    })

    it("freezes the checklist once the task is complete", async () => {
      const { onSilentUpdate } = renderCard({
        as: owner,
        task: task({ taskDescription: items, status: "COMPLETED" }),
      })

      await setupUser().click(screen.getByText("Order the part"))

      expect(onSilentUpdate).not.toHaveBeenCalled()
    })
  })

  describe("the overdue nudge", () => {
    it("warns the owner when an incomplete task is past its deadline", () => {
      const { container } = renderCard({
        as: owner,
        task: task({ status: "INCOMPLETE", endAt: "2020-01-01T00:00:00Z" }),
      })

      expect(within(container).getByText(/overdue/i)).toBeInTheDocument()
    })

    it("does not warn about a task that is not yet due", () => {
      renderCard({
        as: owner,
        task: task({ status: "INCOMPLETE", endAt: "2099-01-01T00:00:00Z" }),
      })

      expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
    })

    it("does not nag a head about somebody else's overdue task", () => {
      renderCard({
        as: head,
        task: task({ status: "INCOMPLETE", endAt: "2020-01-01T00:00:00Z" }),
      })

      expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
    })

    it("does not flag a recalled incomplete task with null endAt as overdue", () => {
      renderCard({
        as: owner,
        task: task({ status: "INCOMPLETE", endAt: null }),
      })

      expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
    })
  })
})
