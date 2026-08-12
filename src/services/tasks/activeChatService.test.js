import { beforeEach, describe, expect, it } from "vitest"
import { activeChatService } from "./activeChatService"
import { db } from "@/test/db/store"
import { stubRpc } from "@/test/msw/server"
import { makeEmployee } from "@/test/factories"

/**
 * The chat drawer's read and archive state. Both are keyed on
 * (user, entity type, entity id), so the same action twice must update the one
 * row rather than pile up duplicates — the composite primary key would reject
 * the second insert.
 */
describe("activeChatService", () => {
  let user

  beforeEach(() => {
    user = makeEmployee({ name: "Ana Reyes" })
  })

  describe("listing active chats", () => {
    it("returns what the database function computes", async () => {
      stubRpc("get_user_active_chats", [
        { entity_type: "TASK", entity_id: "task-1", unread_count: 2 },
      ])

      const chats = await activeChatService.getActiveChats(user.id)

      expect(chats).toEqual([{ entity_type: "TASK", entity_id: "task-1", unread_count: 2 }])
    })

    it("passes the reader and the page size to the function", async () => {
      const calls = []
      stubRpc("get_user_active_chats", (args) => {
        calls.push(args)
        return []
      })

      await activeChatService.getActiveChats(user.id, 5)

      expect(calls).toEqual([{ p_user_id: user.id, p_limit: 5 }])
    })

    it("returns nothing when there is no signed-in user", async () => {
      expect(await activeChatService.getActiveChats(null)).toEqual([])
    })
  })

  describe("marking a thread read", () => {
    it("records a read receipt", async () => {
      await activeChatService.markAsRead(user.id, "TASK", "task-1")

      expect(db.rows("chat_read_receipts")).toHaveLength(1)
      expect(db.rows("chat_read_receipts")[0]).toMatchObject({
        user_id: user.id,
        entity_type: "TASK",
        entity_id: "task-1",
      })
    })

    it("updates the existing receipt instead of adding another", async () => {
      await activeChatService.markAsRead(user.id, "TASK", "task-1")
      const first = db.rows("chat_read_receipts")[0].last_read_at

      await activeChatService.markAsRead(user.id, "TASK", "task-1")

      expect(db.rows("chat_read_receipts")).toHaveLength(1)
      expect(
        new Date(db.rows("chat_read_receipts")[0].last_read_at).getTime(),
      ).toBeGreaterThanOrEqual(new Date(first).getTime())
    })

    it("stores a numeric entity id as text, matching the column", async () => {
      await activeChatService.markAsRead(user.id, "TASK", 42)

      expect(db.rows("chat_read_receipts")[0].entity_id).toBe("42")
    })

    it("does nothing when any part of the key is missing", async () => {
      await activeChatService.markAsRead(null, "TASK", "task-1")
      await activeChatService.markAsRead(user.id, null, "task-1")
      await activeChatService.markAsRead(user.id, "TASK", null)

      expect(db.rows("chat_read_receipts")).toEqual([])
    })
  })

  describe("archiving threads", () => {
    it("archives several threads at once", async () => {
      await activeChatService.archiveChats(user.id, [
        { entityType: "TASK", entityId: "task-1" },
        { entityType: "COMMITTEE_TASK", entityId: "ct-1" },
      ])

      expect(db.rows("chat_user_archives")).toHaveLength(2)
    })

    it("accepts either naming convention for the chat key", async () => {
      await activeChatService.archiveChats(user.id, [
        { entity_type: "TASK", entity_id: "task-1" },
      ])

      expect(db.rows("chat_user_archives")[0]).toMatchObject({
        entity_type: "TASK",
        entity_id: "task-1",
      })
    })

    it("archiving twice leaves one row", async () => {
      const chat = [{ entityType: "TASK", entityId: "task-1" }]
      await activeChatService.archiveChats(user.id, chat)

      await activeChatService.archiveChats(user.id, chat)

      expect(db.rows("chat_user_archives")).toHaveLength(1)
    })

    it("brings archived threads back", async () => {
      await activeChatService.archiveChats(user.id, [{ entityType: "TASK", entityId: "task-1" }])

      await activeChatService.unarchiveChats(user.id, [
        { entityType: "TASK", entityId: "task-1" },
      ])

      expect(db.rows("chat_user_archives")).toEqual([])
    })

    it("leaves another user's archive alone", async () => {
      const colleague = makeEmployee({ name: "Ben Cruz" })
      await activeChatService.archiveChats(colleague.id, [
        { entityType: "TASK", entityId: "task-1" },
      ])

      await activeChatService.unarchiveChats(user.id, [
        { entityType: "TASK", entityId: "task-1" },
      ])

      expect(db.rows("chat_user_archives")).toHaveLength(1)
    })

    it("does nothing for an empty selection", async () => {
      await expect(activeChatService.archiveChats(user.id, [])).resolves.toBeUndefined()
      await expect(activeChatService.unarchiveChats(user.id, [])).resolves.toBeUndefined()
    })
  })
})
