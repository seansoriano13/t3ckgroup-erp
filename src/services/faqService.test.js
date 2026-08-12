import { describe, expect, it } from "vitest"
import { loadFAQFromDB, saveFAQToDB } from "./faqService"
import { db } from "@/test/db/store"

/**
 * The FAQ lives as one JSON row. It must never break the help screen: an
 * unsaved FAQ reads as an empty list rather than throwing.
 */
describe("faqService", () => {
  const categories = [
    { title: "Tasks", items: [{ q: "How do I log a task?", a: "Use the Log Task button." }] },
  ]

  it("returns an empty list before anything has been saved", async () => {
    expect(await loadFAQFromDB()).toEqual([])
  })

  it("saves and reads back the FAQ", async () => {
    await saveFAQToDB(categories)

    expect(await loadFAQFromDB()).toEqual(categories)
  })

  it("replaces the FAQ rather than accumulating rows", async () => {
    await saveFAQToDB(categories)
    await saveFAQToDB([{ title: "Leave", items: [] }])

    expect(await loadFAQFromDB()).toEqual([{ title: "Leave", items: [] }])
    expect(db.rows("faq_data")).toHaveLength(1)
  })

  it("stamps when the FAQ was last edited", async () => {
    await saveFAQToDB(categories)

    expect(db.rows("faq_data")[0].updated_at).toBeTruthy()
  })
})
