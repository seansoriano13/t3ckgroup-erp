import { beforeEach, describe, expect, it } from "vitest"
import { notificationService } from "./notificationService"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee, makeHead, makeHrEmployee, makeNotification, makeSuperAdmin } from "@/test/factories"

/**
 * Notifications decide who finds out that something needs their attention.
 * The routing rules — role broadcasts and department-head targeting — are what
 * keeps a leave request in front of HR and out of everyone else's drawer.
 */
describe("notificationService", () => {
  let recipient

  beforeEach(() => {
    recipient = makeEmployee({ name: "Ana Reyes" })
  })

  describe("reading", () => {
    it("returns only the reader's own notifications, newest first", async () => {
      const other = makeEmployee({ name: "Ben Cruz" })
      makeNotification({ recipient_id: recipient.id, title: "First" })
      makeNotification({ recipient_id: recipient.id, title: "Second" })
      makeNotification({ recipient_id: other.id, title: "Not yours" })

      const mine = await notificationService.getMyNotifications(recipient.id)

      expect(mine.map((n) => n.title)).toEqual(["Second", "First"])
    })

    it("attaches the sender so the drawer can show who acted", async () => {
      const sender = makeHead({ name: "Head Ito", department: "IT", avatar_path: "head.png" })
      makeNotification({ recipient_id: recipient.id, sender_id: sender.id })

      const [notification] = await notificationService.getMyNotifications(recipient.id)

      expect(notification.sender).toMatchObject({ name: "Head Ito", department: "IT" })
    })

    it("returns nothing for a missing user", async () => {
      expect(await notificationService.getMyNotifications(null)).toEqual([])
    })

    it("caps the drawer at fifty entries", async () => {
      for (let i = 0; i < 55; i += 1) makeNotification({ recipient_id: recipient.id })

      expect(await notificationService.getMyNotifications(recipient.id)).toHaveLength(50)
    })
  })

  describe("read state", () => {
    it("marks one notification read", async () => {
      const notification = makeNotification({ recipient_id: recipient.id })

      await notificationService.markAsRead(notification.id)

      const [stored] = await notificationService.getMyNotifications(recipient.id)
      expect(stored.is_read).toBe(true)
    })

    it("marks one notification unread again", async () => {
      const notification = makeNotification({ recipient_id: recipient.id, is_read: true })

      await notificationService.markAsUnread(notification.id)

      const [stored] = await notificationService.getMyNotifications(recipient.id)
      expect(stored.is_read).toBe(false)
    })

    it("marks every unread notification read without touching anyone else's", async () => {
      const other = makeEmployee({ name: "Ben Cruz" })
      makeNotification({ recipient_id: recipient.id })
      makeNotification({ recipient_id: recipient.id })
      makeNotification({ recipient_id: other.id })

      await notificationService.markAllAsRead(recipient.id)

      const mine = await notificationService.getMyNotifications(recipient.id)
      const theirs = await notificationService.getMyNotifications(other.id)
      expect(mine.every((n) => n.is_read)).toBe(true)
      expect(theirs[0].is_read).toBe(false)
    })

    it("does nothing without a user", async () => {
      await expect(notificationService.markAllAsRead(null)).resolves.toBeUndefined()
    })
  })

  describe("deleting", () => {
    it("removes the notification from the drawer", async () => {
      const notification = makeNotification({ recipient_id: recipient.id })

      await notificationService.deleteNotification(notification.id)

      expect(await notificationService.getMyNotifications(recipient.id)).toEqual([])
    })
  })

  describe("role broadcasts", () => {
    it("reaches HR and super admins, and nobody else", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      const boss = makeSuperAdmin({ name: "Boss" })
      const head = makeHead({ name: "Head Ito" })

      await notificationService.broadcastToRole(["HR", "SUPER_ADMIN"], {
        type: "SIL_LEAVE_REQUEST",
        title: "New request",
        message: "Someone applied",
      })
      await waitForNetworkIdle()

      const reached = await recipientsOf()
      expect(reached.sort()).toEqual([boss.id, hr.id].sort())
      expect(reached).not.toContain(head.id)
      expect(reached).not.toContain(recipient.id)
    })

    it("reaches heads when the broadcast names that role", async () => {
      const head = makeHead({ name: "Head Ito" })

      await notificationService.broadcastToRole(["HEAD"], {
        type: "NEW_TASK_SUBMITTED",
        title: "New task",
        message: "Please review",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([head.id])
    })

    it("can leave super admins out of an HR-only signal", async () => {
      const hr = makeHrEmployee({ name: "HR Officer" })
      makeSuperAdmin({ name: "Boss" })

      await notificationService.broadcastToRole(["HR", "SUPER_ADMIN"], {
        type: "SIL_LEAVE_REQUEST",
        title: "HR only",
        message: "For HR",
        excludeSuperAdmin: true,
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([hr.id])
    })

    it("skips deactivated accounts", async () => {
      makeHrEmployee({ name: "Former HR", is_deleted: true })

      await notificationService.broadcastToRole(["HR"], {
        type: "SIL_LEAVE_REQUEST",
        title: "New request",
        message: "Someone applied",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([])
    })

    it("sends one notification even to someone holding two of the roles", async () => {
      const both = makeEmployee({ name: "HR Boss", is_hr: true, is_super_admin: true })

      await notificationService.broadcastToRole(["HR", "SUPER_ADMIN"], {
        type: "SIL_LEAVE_REQUEST",
        title: "New request",
        message: "Someone applied",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([both.id])
    })
  })

  describe("department-head targeting", () => {
    it("notifies the head of the matching department", async () => {
      const itHead = makeHead({ name: "IT Head", department: "IT", sub_department: null })
      makeHead({ name: "Sales Head", department: "SALES", sub_department: null })

      await notificationService.notifyHeadByDepartment("IT", null, {
        type: "NEW_TASK_SUBMITTED",
        title: "New task",
        message: "Please review",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([itHead.id])
    })

    it("prefers the sub-department head when the task has one", async () => {
      const infraHead = makeHead({ name: "Infra Head", department: "IT", sub_department: "Infra" })
      const itHead = makeHead({ name: "IT Head", department: "IT", sub_department: null })

      await notificationService.notifyHeadByDepartment("IT", "Infra", {
        type: "NEW_TASK_SUBMITTED",
        title: "New task",
        message: "Please review",
      })
      await waitForNetworkIdle()

      const reached = await recipientsOf()
      expect(reached).toContain(infraHead.id)
      expect(reached).toContain(itHead.id)
    })

    it("matches department names case-insensitively and ignores padding", async () => {
      const head = makeHead({ name: "IT Head", department: " it ", sub_department: null })

      await notificationService.notifyHeadByDepartment("IT", null, {
        type: "NEW_TASK_SUBMITTED",
        title: "New task",
        message: "Please review",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([head.id])
    })

    it("sends nothing when no head matches", async () => {
      makeHead({ name: "Sales Head", department: "SALES", sub_department: null })

      await notificationService.notifyHeadByDepartment("LEGAL", null, {
        type: "NEW_TASK_SUBMITTED",
        title: "New task",
        message: "Please review",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([])
    })

    it("does nothing when neither department nor sub-department is given", async () => {
      makeHead({ name: "IT Head", department: "IT" })

      await notificationService.notifyHeadByDepartment(null, null, {
        type: "NEW_TASK_SUBMITTED",
        title: "New task",
        message: "Please review",
      })
      await waitForNetworkIdle()

      expect(await recipientsOf()).toEqual([])
    })
  })
})

async function recipientsOf() {
  const { db } = await import("@/test/db/store")
  return db.rows("notifications").map((n) => n.recipient_id)
}
