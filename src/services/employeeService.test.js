import { beforeEach, describe, expect, it } from "vitest"
import { employeeService } from "./employeeService"
import { db } from "@/test/db/store"
import { waitForNetworkIdle } from "@/test/network"
import { makeCategory, makeEmployee, makeSuperAdmin, makeTask } from "@/test/factories"

/**
 * The employee directory is the app's identity source: it decides who is a
 * head, who is HR, and what leave balances they carry. Email uniqueness is
 * enforced in this service rather than by the table, which makes it the one
 * thing standing between a rehire and two accounts answering to one address.
 */
describe("employeeService", () => {
  let actor

  beforeEach(() => {
    actor = makeSuperAdmin({ name: "Boss" })
  })

  describe("reading the directory", () => {
    it("maps a row onto the camelCase identity the app uses", async () => {
      makeEmployee({
        name: "Ana Reyes",
        email: "ana@t3ckgroup.test",
        department: "IT",
        sub_department: "Infra",
        is_head: true,
        sil_hours_balance: 24,
      })

      const found = await employeeService.getEmployeeByEmail("ana@t3ckgroup.test")

      expect(found).toMatchObject({
        name: "Ana Reyes",
        department: "IT",
        subDepartment: "Infra",
        isHead: true,
        isHr: false,
        isSuperAdmin: false,
        sil_hours_balance: 24,
      })
    })

    it("maps the leave-management capability alongside the other role flags", async () => {
      makeEmployee({ email: "ysabelle@t3ckgroup.test", can_manage_leaves: true })

      const found = await employeeService.getEmployeeByEmail("ysabelle@t3ckgroup.test")

      expect(found.canManageLeaves).toBe(true)
    })

    it("maps the Bug Reports access right", async () => {
      makeEmployee({ email: "it@t3ckgroup.test", has_bug_report_access: true })

      const found = await employeeService.getEmployeeByEmail("it@t3ckgroup.test")

      expect(found.has_bug_report_access).toBe(true)
    })

    it("maps Finance access, defaulting to off", async () => {
      makeEmployee({ email: "fin@t3ckgroup.test", has_finance_flow: true })
      makeEmployee({ email: "plain@t3ckgroup.test" })

      expect((await employeeService.getEmployeeByEmail("fin@t3ckgroup.test")).has_finance_flow).toBe(true)
      expect((await employeeService.getEmployeeByEmail("plain@t3ckgroup.test")).has_finance_flow).toBe(false)
      const all = await employeeService.getAllEmployees()
      expect(all.find((e) => e.email === "fin@t3ckgroup.test").has_finance_flow).toBe(true)
    })

    it("maps the call sign, null when none", async () => {
      makeEmployee({ email: "boss@t3ckgroup.test", call_sign: "101" })
      makeEmployee({ email: "nobody@t3ckgroup.test" })

      expect((await employeeService.getEmployeeByEmail("boss@t3ckgroup.test")).call_sign).toBe("101")
      expect((await employeeService.getEmployeeByEmail("nobody@t3ckgroup.test")).call_sign).toBeNull()
      const all = await employeeService.getAllEmployees()
      expect(all.find((e) => e.email === "boss@t3ckgroup.test").call_sign).toBe("101")
      expect(all.find((e) => e.email === "nobody@t3ckgroup.test").call_sign).toBeNull()
    })

    it("marks an employee who is on an IPAS sign-off list, and nobody else", async () => {
      const signer = makeEmployee({ email: "signer@t3ckgroup.test" })
      makeEmployee({ email: "bystander@t3ckgroup.test" })
      db.seed("ipas_signer_lists", { list_key: "s1_approved", employee_id: signer.id })

      expect((await employeeService.getEmployeeByEmail("signer@t3ckgroup.test")).isIpasSigner).toBe(true)
      expect((await employeeService.getEmployeeByEmail("bystander@t3ckgroup.test")).isIpasSigner).toBe(false)
    })

    it("maps hidden_nav_keys onto hiddenNavKeys, defaulting to empty", async () => {
      makeEmployee({ email: "hidden@t3ckgroup.test", hidden_nav_keys: ["sales.commissionDashboard"] })
      makeEmployee({ email: "unhidden@t3ckgroup.test" })

      const withOverride = await employeeService.getEmployeeByEmail("hidden@t3ckgroup.test")
      const withoutOverride = await employeeService.getEmployeeByEmail("unhidden@t3ckgroup.test")

      expect(withOverride.hiddenNavKeys).toEqual(["sales.commissionDashboard"])
      expect(withoutOverride.hiddenNavKeys).toEqual([])

      const all = await employeeService.getAllEmployees()
      expect(all.find((e) => e.email === "hidden@t3ckgroup.test").hiddenNavKeys).toEqual([
        "sales.commissionDashboard",
      ])
    })

    it("returns null for an unknown address rather than throwing", async () => {
      expect(await employeeService.getEmployeeByEmail("nobody@t3ckgroup.test")).toBeNull()
    })

    it("refuses to sign in a deactivated account", async () => {
      makeEmployee({ email: "gone@t3ckgroup.test", is_deleted: true })

      expect(await employeeService.getEmployeeByEmail("gone@t3ckgroup.test")).toBeNull()
    })

    it("lists everyone except deactivated accounts", async () => {
      makeEmployee({ name: "Ana Reyes" })
      makeEmployee({ name: "Gone", is_deleted: true })

      const everyone = await employeeService.getAllEmployees()

      expect(everyone.map((e) => e.name).sort()).toEqual(["Ana Reyes", "Boss"])
    })

    it("substitutes zero for balances that were never set", async () => {
      makeEmployee({ name: "New Hire", sil_hours_balance: null, offset_hours_balance: 0 })

      const found = await employeeService.getAllEmployees()
      const hire = found.find((e) => e.name === "New Hire")

      expect(hire).toMatchObject({ sil_hours_balance: 0, offset_hours_balance: 0 })
    })

    it("maps the leave-management capability in the full directory listing", async () => {
      makeEmployee({ name: "Ysabelle", can_manage_leaves: true })

      const found = await employeeService.getAllEmployees()

      expect(found.find((e) => e.name === "Ysabelle").canManageLeaves).toBe(true)
    })

    it("maps the signature path in both getEmployeeByEmail and getAllEmployees", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test", signature_path: "ana-sig.png" })

      const single = await employeeService.getEmployeeByEmail("ana@t3ckgroup.test")
      expect(single.signaturePath).toBe("ana-sig.png")

      const all = await employeeService.getAllEmployees()
      expect(all.find((e) => e.name === "Ana Reyes").signaturePath).toBe("ana-sig.png")
    })
  })

  describe("creating an employee", () => {
    it("stores the new employee so they can sign in", async () => {
      await employeeService.createEmployee({
        name: "Ana Reyes",
        email: "ana@t3ckgroup.test",
        department: "IT",
        subDepartment: "Infra",
        role: "EMPLOYEE",
        isHead: false,
        isHr: false,
        isSuperAdmin: false,
        updatedBy: actor.id,
      })

      expect(await employeeService.getEmployeeByEmail("ana@t3ckgroup.test")).toMatchObject({
        name: "Ana Reyes",
        department: "IT",
      })
    })

    it("stores a typed call sign, and none for a blank one", async () => {
      const base = { department: "OPERATIONS", role: "EMPLOYEE", updatedBy: actor.id }
      await employeeService.createEmployee({ ...base, name: "Cs", email: "cs@t3ckgroup.test", call_sign: " 1203 " })
      await employeeService.createEmployee({ ...base, name: "None", email: "none@t3ckgroup.test", call_sign: "" })
      await employeeService.createEmployee({ ...base, name: "Unset", email: "unset@t3ckgroup.test" })

      const sign = (email) => db.rows("employees").find((e) => e.email === email).call_sign
      expect(sign("cs@t3ckgroup.test")).toBe("1203")
      expect(sign("none@t3ckgroup.test")).toBeNull()
      expect(sign("unset@t3ckgroup.test")).toBeNull()
    })

    it("opens Bug Reports by default for the IT Team, and an explicit choice wins", async () => {
      const base = { department: "OPERATIONS", role: "EMPLOYEE", updatedBy: actor.id }
      await employeeService.createEmployee({ ...base, name: "IT", email: "it@t3ckgroup.test", subDepartment: " it " })
      await employeeService.createEmployee({ ...base, name: "Log", email: "log@t3ckgroup.test", subDepartment: "LOGISTICS" })
      await employeeService.createEmployee({
        ...base, name: "IT2", email: "it2@t3ckgroup.test", subDepartment: "IT", has_bug_report_access: false,
      })

      const flag = (email) => db.rows("employees").find((e) => e.email === email).has_bug_report_access
      expect(flag("it@t3ckgroup.test")).toBe(true)
      expect(flag("log@t3ckgroup.test")).toBe(false)
      expect(flag("it2@t3ckgroup.test")).toBe(false)
    })

    it("refuses an email an active employee already uses", async () => {
      makeEmployee({ email: "ana@t3ckgroup.test" })

      await expect(
        employeeService.createEmployee({ name: "Impostor", email: "ana@t3ckgroup.test" }),
      ).rejects.toThrow('An active employee with the email "ana@t3ckgroup.test" already exists.')
    })

    it("blocks the save with a clear message if the duplicate-email lookup errors", async () => {
      const { server } = await import("@/test/msw/server")
      const { http, HttpResponse } = await import("msw")
      const BASE_URL = import.meta.env.VITE_SUPABASE_URL

      server.use(
        http.get(`${BASE_URL}/rest/v1/employees`, () => {
          return HttpResponse.json({ message: "Network error" }, { status: 500 })
        })
      )

      await expect(
        employeeService.createEmployee({ name: "Impostor", email: "ana@t3ckgroup.test" })
      ).rejects.toThrow("Unable to verify if email is already in use. Please try again.")
    })

    it("trims the address before checking it", async () => {
      makeEmployee({ email: "ana@t3ckgroup.test" })

      await expect(
        employeeService.createEmployee({ name: "Impostor", email: "  ana@t3ckgroup.test  " }),
      ).rejects.toThrow(/already exists/)
    })

    it("frees an address held by a deactivated account so a rehire can use it", async () => {
      const old = makeEmployee({ name: "Ana Reyes (old)", email: "ana@t3ckgroup.test" })
      await employeeService.deleteEmployee(old.id, actor.id)

      await employeeService.createEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })

      expect(await employeeService.getEmployeeByEmail("ana@t3ckgroup.test")).toMatchObject({
        name: "Ana Reyes",
      })
    })

    it("records the creation in the audit log", async () => {
      await employeeService.createEmployee({
        name: "Ana Reyes",
        email: "ana@t3ckgroup.test",
        department: "IT",
        updatedBy: actor.id,
      })
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").find((e) => e.entity_type === "EMPLOYEE")
      expect(entry.content).toContain('Employee "Ana Reyes" was created')
      expect(entry.author_id).toBe(actor.id)
    })
  })

  describe("updating an employee", () => {
    it("saves the change", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ana Reyes-Cruz", email: "ana@t3ckgroup.test", department: "OPS" },
        actor.id,
      )

      expect(await employeeService.getEmployeeByEmail("ana@t3ckgroup.test")).toMatchObject({
        name: "Ana Reyes-Cruz",
        department: "OPS",
      })
    })

    it("lets an employee keep their own email address", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })

      await expect(
        employeeService.updateEmployee(
          employee.id,
          { name: "Ana Reyes", email: "ana@t3ckgroup.test" },
          actor.id,
        ),
      ).resolves.toBeTruthy()
    })

    it("writes hiddenNavKeys through to hidden_nav_keys", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ana Reyes", email: "ana@t3ckgroup.test", hiddenNavKeys: ["hr.activityLog"] },
        actor.id,
      )

      expect(await employeeService.getEmployeeByEmail("ana@t3ckgroup.test")).toMatchObject({
        hiddenNavKeys: ["hr.activityLog"],
      })
    })

    it("refuses to move an employee onto a colleague's address", async () => {
      makeEmployee({ email: "ben@t3ckgroup.test" })
      const employee = makeEmployee({ email: "ana@t3ckgroup.test" })

      await expect(
        employeeService.updateEmployee(
          employee.id,
          { name: "Ana", email: "ben@t3ckgroup.test" },
          actor.id,
        ),
      ).rejects.toThrow(/already exists/)
    })

    it("spells out a leave-balance change in the audit log", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", sil_hours_balance: 40 })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ana Reyes", email: null, sil_hours_balance: 16 },
        actor.id,
      )
      await waitForNetworkIdle()

      const entry = db.rows("system_audit_logs").at(-1)
      expect(entry.content).toContain("SIL balance changed from 40 to 16 hrs")
      expect(entry.metadata.hasBalanceOrStatusChange).toBe(true)
    })

    it("spells out an employment-status change in the audit log", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", employment_status: "Probationary" })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ana Reyes", email: null, employment_status: "Regular" },
        actor.id,
      )
      await waitForNetworkIdle()

      expect(db.rows("system_audit_logs").at(-1).content).toContain(
        'employment status changed from "Probationary" to "Regular"',
      )
    })

    it("leaves balances alone when the caller did not mention them", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", sil_hours_balance: 40 })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ana Reyes-Cruz", email: null },
        actor.id,
      )

      expect(db.rows("employees").find((e) => e.id === employee.id).sil_hours_balance).toBe(40)
    })

    it("saves a grant of the Bug Reports access right", async () => {
      const employee = makeEmployee({ name: "Ian", has_bug_report_access: false })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ian", email: null, has_bug_report_access: true },
        actor.id,
      )

      expect(db.rows("employees").find((e) => e.id === employee.id).has_bug_report_access).toBe(true)
    })

    it("saves a grant of Finance access", async () => {
      const employee = makeEmployee({ name: "Fe", has_finance_flow: false })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Fe", email: null, has_finance_flow: true },
        actor.id,
      )

      expect(db.rows("employees").find((e) => e.id === employee.id).has_finance_flow).toBe(true)
    })

    it("saves a call sign trimmed, turns blank into none, and leaves it alone when the caller says nothing", async () => {
      const employee = makeEmployee({ name: "Cal", call_sign: null })
      const callSign = () => db.rows("employees").find((e) => e.id === employee.id).call_sign

      await employeeService.updateEmployee(employee.id, { name: "Cal", email: null, call_sign: "  1203 " }, actor.id)
      expect(callSign()).toBe("1203")

      await employeeService.updateEmployee(employee.id, { name: "Cal", email: null }, actor.id)
      expect(callSign()).toBe("1203")

      await employeeService.updateEmployee(employee.id, { name: "Cal", email: null, call_sign: "   " }, actor.id)
      expect(callSign()).toBeNull()

      await employeeService.updateEmployee(employee.id, { name: "Cal", email: null, call_sign: "" }, actor.id)
      expect(callSign()).toBeNull()
    })

    it("saves a grant of the leave-management capability", async () => {
      const employee = makeEmployee({ name: "Ysabelle", can_manage_leaves: false })

      await employeeService.updateEmployee(
        employee.id,
        { name: "Ysabelle", email: null, canManageLeaves: true },
        actor.id,
      )

      expect(db.rows("employees").find((e) => e.id === employee.id).can_manage_leaves).toBe(true)
    })
  })

  describe("deactivating an employee", () => {
    it("keeps the record and marks it deleted", async () => {
      const employee = makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })

      await employeeService.deleteEmployee(employee.id, actor.id)

      const stored = db.rows("employees").find((e) => e.id === employee.id)
      expect(stored.is_deleted).toBe(true)
    })

    it("archives the address so it can be reused", async () => {
      const employee = makeEmployee({ email: "ana@t3ckgroup.test" })

      await employeeService.deleteEmployee(employee.id, actor.id)

      const stored = db.rows("employees").find((e) => e.id === employee.id)
      expect(stored.email).toMatch(/^ana@t3ckgroup\.test#deleted_\d+$/)
    })

    it("does not stack archive suffixes when an account is deleted twice", async () => {
      const employee = makeEmployee({ email: "ana@t3ckgroup.test" })
      await employeeService.deleteEmployee(employee.id, actor.id)

      await employeeService.deleteEmployee(employee.id, actor.id)

      const stored = db.rows("employees").find((e) => e.id === employee.id)
      expect(stored.email.match(/#deleted_/g)).toHaveLength(1)
    })
  })

  describe("categories", () => {
    it("lists categories in the shape the settings screen wants", async () => {
      makeCategory({ category_id: "IT-01", description: "Support", department: "IT" })

      const [category] = await employeeService.getAllCategories()

      expect(category).toMatchObject({
        categoryId: "IT-01",
        description: "Support",
        department: "IT",
      })
    })

    it("reports a category as in use once a task references it", async () => {
      const category = makeCategory({ category_id: "IT-01" })
      expect(await employeeService.isCategoryInUse(category.category_id)).toBe(false)

      makeTask({ category_id: category.category_id })

      expect(await employeeService.isCategoryInUse(category.category_id)).toBe(true)
    })

    it("removes an unused category", async () => {
      const category = makeCategory({ category_id: "IT-99" })

      await employeeService.deleteCategory(category.id, actor.id)

      expect(await employeeService.getAllCategories()).toEqual([])
    })
  })

  describe("self-service preferences", () => {
    it("saves the avatar without touching the other preferences", async () => {
      const employee = makeEmployee({ dashboard_quote: "Keep going" })

      await employeeService.updateSelfPreferences(employee.id, { avatarPath: "new-avatar.png" })

      const stored = db.rows("employees").find((e) => e.id === employee.id)
      expect(stored).toMatchObject({
        avatar_path: "new-avatar.png",
        dashboard_quote: "Keep going",
      })
    })

    it("clears a preference when an empty value is saved", async () => {
      const employee = makeEmployee({ dashboard_quote: "Keep going" })

      await employeeService.updateSelfPreferences(employee.id, { dashboardQuote: "" })

      expect(db.rows("employees").find((e) => e.id === employee.id).dashboard_quote).toBeNull()
    })

    it("returns a usable shape even when the update matched no row", async () => {
      const result = await employeeService.updateSelfPreferences(
        "00000000-0000-4000-8000-000000009999",
        { avatarPath: "x.png" },
      )

      expect(result).toMatchObject({ avatar_path: "x.png" })
    })
  })

  describe("avatar paths", () => {
    it("returns id and avatar for every active employee", async () => {
      makeEmployee({ name: "Ana Reyes", avatar_path: "ana.png" })
      makeEmployee({ name: "Gone", is_deleted: true, avatar_path: "gone.png" })

      const paths = await employeeService.getEmployeeAvatarPaths()

      expect(paths.map((p) => p.avatar_path)).not.toContain("gone.png")
      expect(paths.map((p) => p.avatar_path)).toContain("ana.png")
    })
  })
})
