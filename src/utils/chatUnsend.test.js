import { describe, expect, it } from "vitest"
import { canUnsend, isMessageRemoved, UNSEND_WINDOW_MS } from "./chatUnsend"

const NOW = new Date("2026-10-22T10:00:00Z").getTime()
const sentAgo = (ms) => new Date(NOW - ms).toISOString()
const message = (over = {}) => ({
  id: "m1",
  type: "COMMENT",
  authorId: "me",
  createdAt: sentAgo(60 * 1000),
  metadata: null,
  ...over,
})

describe("canUnsend", () => {
  it("lets the sender unsend within 15 minutes", () => {
    expect(canUnsend(message(), "me", NOW)).toBe(true)
    expect(canUnsend(message({ createdAt: sentAgo(UNSEND_WINDOW_MS) }), "me", NOW)).toBe(true)
  })

  it("refuses after 15 minutes", () => {
    expect(canUnsend(message({ createdAt: sentAgo(UNSEND_WINDOW_MS + 1000) }), "me", NOW)).toBe(false)
  })

  it("refuses on someone else's message", () => {
    expect(canUnsend(message({ authorId: "other" }), "me", NOW)).toBe(false)
  })

  it("refuses an already removed message or a non-comment entry", () => {
    expect(canUnsend(message({ metadata: { removed: true } }), "me", NOW)).toBe(false)
    expect(canUnsend(message({ type: "STATUS_CHANGE" }), "me", NOW)).toBe(false)
  })
})

describe("isMessageRemoved", () => {
  it("reads the removed flag", () => {
    expect(isMessageRemoved({ metadata: { removed: true } })).toBe(true)
    expect(isMessageRemoved({ metadata: null })).toBe(false)
  })
})
