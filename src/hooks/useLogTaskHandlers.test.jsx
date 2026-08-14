import { act, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import { useLogTaskHandlers } from "./useLogTaskHandlers"
import { renderHookWithQuery } from "@/test/support"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeCategory, makeEmployee, makeHead, makeSuperAdmin } from "@/test/factories"

/**
 * The log-task form's brain: validation, auto-routing to the right head, draft
 * save on close, and the optimistic write. Its validation is the last gate
 * before a task is filed against the wrong person or with no category, and its
 * draft handling is what stops an employee losing a half-written entry.
 */
describe("useLogTaskHandlers", () => {
  let user
  let itHead
  let category
  let onClose

  beforeEach(() => {
    user = makeEmployee({ name: "Ana Reyes", department: "IT", sub_department: "Infra" })
    itHead = makeHead({ name: "Infra Head", department: "IT", sub_department: "Infra" })
    category = makeCategory({ category_id: "IT-01", description: "Support" })
    onClose = vi.fn()
    localStorage.clear()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
  })

  /**
   * Mounts and waits for the open-the-form effect to settle. That effect
   * restores (or clears) the draft inside a microtask, so anything typed
   * before it runs would be wiped — exactly as it would be for a user who
   * somehow typed in the same tick the modal opened.
   */
  const mount = async ({ isOpen = true, roles = {}, employees, availableHeads } = {}) => {
    const rendered = renderHookWithQuery(() =>
      useLogTaskHandlers({
        isOpen,
        onClose,
        user: { id: user.id, name: user.name, department: "IT", sub_department: "Infra" },
        employees: employees ?? [
          { id: user.id, name: user.name, department: "IT", sub_department: "Infra" },
        ],
        availableHeads:
          availableHeads ?? [
            { id: itHead.id, name: "Infra Head", department: "IT", sub_department: "Infra", is_head: true },
          ],
        roles: { isHr: false, isHead: false, isSuperAdmin: false, ...roles },
      }),
    )
    await act(async () => {})
    return rendered
  }

  const fill = async (result, fields) => {
    await act(async () => {
      result.current.setFormData((prev) => ({ ...prev, ...fields }))
    })
  }

  const submit = async (result, options = { isGroup: false, isOthersGlobal: false }) => {
    await act(async () => {
      result.current.handleSubmit({ preventDefault: vi.fn() }, options)
    })
  }

  describe("validation", () => {
    it("refuses to log a task with no category", async () => {
      const { result } = await mount()
      await fill(result, { taskDescription: "Replace the switch" })

      await submit(result)

      expect(toast.error).toHaveBeenCalledWith(
        "Please select a Category before logging your task.",
      )
      expect(db.rows("tasks")).toEqual([])
    })

    it("requires a group role on a group task", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Minutes" })

      await submit(result, { isGroup: true, isOthersGlobal: false })

      expect(toast.error).toHaveBeenCalledWith("Please select a specific Group Role.")
      expect(db.rows("tasks")).toEqual([])
    })

    it("requires details when the group role is Others", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Minutes" })
      await act(async () => result.current.setGroupRole("OTHERS"))

      await submit(result, { isGroup: true, isOthersGlobal: false })

      expect(toast.error).toHaveBeenCalledWith("Please specify details for 'Others'.")
    })

    it("requires details on a global Others task", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Minutes" })

      await submit(result, { isGroup: false, isOthersGlobal: true })

      expect(toast.error).toHaveBeenCalledWith(
        "Please specify details for your 'Others' task.",
      )
    })

    it("requires a description or a checklist", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "" })

      await submit(result)

      expect(toast.error).toHaveBeenCalledWith(
        "Please add a description or checklist items.",
      )
      expect(db.rows("tasks")).toEqual([])
    })

    it("accepts a checklist on its own, with no plain-text description", async () => {
      const { result } = await mount()
      await fill(result, {
        categoryId: category.category_id,
        taskDescription: "",
        checklist: JSON.stringify([{ text: "Order the part", checked: false }]),
      })

      await submit(result)

      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))
    })
  })

  describe("filing the task", () => {
    it("creates the task with what the form holds", async () => {
      const { result } = await mount()
      await fill(result, {
        categoryId: category.category_id,
        taskDescription: "Replace the switch",
        projectTitle: "Network refresh",
        priority: "HIGH",
      })

      await submit(result)
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(db.rows("tasks")[0]).toMatchObject({
        task_description: "Replace the switch",
        project_title: "Network refresh",
        priority: "HIGH",
        category_id: "IT-01",
        logged_by: user.id,
        status: "INCOMPLETE",
      })
    })

    it("tags a group task with its role in the remarks", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Minutes" })
      await act(async () => result.current.setGroupRole("SAFETY"))

      await submit(result, { isGroup: true, isOthersGlobal: false })
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(db.rows("tasks")[0].remarks).toBe("[GROUP - SAFETY]")
    })

    it("appends the free text for a group Others task", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Minutes" })
      await act(async () => {
        result.current.setGroupRole("OTHERS")
        result.current.setOthersRemarks("  Budget review  ")
      })

      await submit(result, { isGroup: true, isOthersGlobal: false })
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(db.rows("tasks")[0].remarks).toBe("[GROUP - OTHERS] Budget review")
    })

    it("tags a global Others task", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Site visit" })
      await act(async () => result.current.setOthersRemarks("Client site visit"))

      await submit(result, { isGroup: false, isOthersGlobal: true })
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(db.rows("tasks")[0].remarks).toBe("[OTHERS] Client site visit")
    })

    it("stores a blank payment voucher as nothing at all", async () => {
      const { result } = await mount()
      await fill(result, {
        categoryId: category.category_id,
        taskDescription: "Replace the switch",
        paymentVoucher: "   ",
      })

      await submit(result)
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(db.rows("tasks")[0].payment_voucher).toBeNull()
    })

    it("closes the form and confirms once the task is filed", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Replace" })

      await submit(result)
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Task created successfully!"))

      expect(onClose).toHaveBeenCalled()
    })

    it("keeps the form open and cleared when logging several in a row", async () => {
      const { result } = await mount()
      await act(async () => result.current.setCreateMore(true))
      await fill(result, { categoryId: category.category_id, taskDescription: "First one" })

      await submit(result)
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(onClose).not.toHaveBeenCalled()
      await waitFor(() => expect(result.current.formData.taskDescription).toBe(""))
      expect(result.current.formData.categoryId).toBe("")
    })

    it("shows the task immediately, before the write comes back", async () => {
      const { client, result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Replace" })

      act(() => {
        result.current.handleSubmit({ preventDefault: vi.fn() }, {
          isGroup: false,
          isOthersGlobal: false,
        })
      })

      await waitFor(() => {
        const optimistic = client.getQueryData(["dashboardTasks"])
        expect(optimistic?.[0]?.taskDescription).toBe("Replace")
      })
      await waitForNetworkIdle()
    })

    it("puts the list back and says so when the write fails", async () => {
      const { client, result } = await mount()
      client.setQueryData(["dashboardTasks"], [{ id: "existing", taskDescription: "Was here" }])
      // No such category — the foreign key rejects the insert.
      await fill(result, { categoryId: "DOES-NOT-EXIST", taskDescription: "Doomed" })

      await submit(result)
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Database error: Could not save task."),
      )

      expect(client.getQueryData(["dashboardTasks"])).toEqual([
        { id: "existing", taskDescription: "Was here" },
      ])
    })
  })

  describe("routing to a head", () => {
    it("reports to the head of the employee's own sub-department", async () => {
      const { result } = await mount()

      await waitFor(() => expect(result.current.selectedHead).toBe(itHead.id))
    })

    it("falls back to a super admin when the unit has no head", async () => {
      const boss = makeSuperAdmin({ name: "Boss" })
      const { result } = await mount({
        availableHeads: [
          { id: boss.id, name: "Boss", department: "EXEC", sub_department: null, is_super_admin: true },
        ],
      })

      await waitFor(() => expect(result.current.selectedHead).toBe(boss.id))
    })

    it("reports to nobody when there is no head and no super admin", async () => {
      const { result } = await mount({ availableHeads: [] })

      await waitFor(() => expect(result.current.selectedHead).toBe(""))
    })

    it("files the task against the chosen head", async () => {
      const { result } = await mount()
      await waitFor(() => expect(result.current.selectedHead).toBe(itHead.id))
      await fill(result, { categoryId: category.category_id, taskDescription: "Replace" })

      await submit(result)
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(db.rows("tasks")[0].reported_to).toBe(itHead.id)
    })
  })

  describe("drafts", () => {
    it("saves a half-written entry when the form is closed", async () => {
      const { result } = await mount()
      await fill(result, { taskDescription: "Half written" })

      await act(async () => result.current.handleClose())

      expect(JSON.parse(localStorage.getItem("logTask_draft")).taskDescription).toBe(
        "Half written",
      )
      expect(onClose).toHaveBeenCalled()
    })

    it("saves nothing when the form is empty", async () => {
      const { result } = await mount()

      await act(async () => result.current.handleClose())

      expect(localStorage.getItem("logTask_draft")).toBeNull()
    })

    it("restores the draft the next time the form opens", async () => {
      localStorage.setItem(
        "logTask_draft",
        JSON.stringify({
          loggedById: user.id,
          categoryId: "IT-01",
          projectTitle: "Network refresh",
          taskDescription: "Half written",
          attachments: [],
        }),
      )

      const { result } = await mount()

      await waitFor(() => expect(result.current.formData.taskDescription).toBe("Half written"))
      expect(result.current.formData.projectTitle).toBe("Network refresh")
    })

    it("ignores a draft belonging to somebody else", async () => {
      localStorage.setItem(
        "logTask_draft",
        JSON.stringify({ loggedById: "someone-else", taskDescription: "Not yours" }),
      )

      const { result } = await mount()

      await waitFor(() => expect(result.current.formData.loggedById).toBe(user.id))
      expect(result.current.formData.taskDescription).toBe("")
    })

    it("survives a corrupted draft in storage", async () => {
      localStorage.setItem("logTask_draft", "{not json")

      const { result } = await mount()

      await waitFor(() => expect(result.current.formData.taskDescription).toBe(""))
    })

    it("throws the draft away once the task is filed", async () => {
      const { result } = await mount()
      await fill(result, { categoryId: category.category_id, taskDescription: "Replace" })

      await submit(result)
      await waitFor(() => expect(db.rows("tasks")).toHaveLength(1))

      expect(localStorage.getItem("logTask_draft")).toBeNull()
    })
  })

  describe("the description / checklist tabs", () => {
    // taskDescription and checklist are now two independent form fields —
    // showChecklist only decides which one the modal displays. Switching
    // tabs no longer moves or clears data, unlike the old single-field
    // approach this replaced.
    it("toggles which tab is showing without touching either field's data", async () => {
      const { result } = await mount()
      await fill(result, {
        taskDescription: "Plain prose the user typed",
        checklist: JSON.stringify([{ text: "An item" }]),
      })

      await act(async () => result.current.setShowChecklist(true))
      await act(async () => result.current.setShowChecklist(false))

      expect(result.current.formData.taskDescription).toBe("Plain prose the user typed")
      expect(result.current.formData.checklist).toBe(JSON.stringify([{ text: "An item" }]))
      expect(result.current.showChecklist).toBe(false)
    })

    it("starts on the description tab", async () => {
      const { result } = await mount()

      expect(result.current.showChecklist).toBe(false)
    })
  })

  describe("form plumbing", () => {
    it("updates a field from a change event", async () => {
      const { result } = await mount()

      await act(async () =>
        result.current.handleChange({ target: { name: "projectTitle", value: "Network refresh" } }),
      )

      expect(result.current.formData.projectTitle).toBe("Network refresh")
    })

    it("opens a popover, and closes it when tapped again", async () => {
      const { result } = await mount()

      await act(async () => result.current.handleTogglePopover("category"))
      expect(result.current.openPopover).toBe("category")

      await act(async () => result.current.handleTogglePopover("category"))
      expect(result.current.openPopover).toBeNull()
    })

    it("clears the category search when the category popover opens", async () => {
      const { result } = await mount()
      await act(async () => result.current.setCategorySearch("switch"))

      await act(async () => result.current.handleTogglePopover("category"))

      expect(result.current.categorySearch).toBe("")
    })
  })
})
