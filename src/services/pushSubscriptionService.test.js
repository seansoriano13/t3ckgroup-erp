import { describe, expect, it } from "vitest"
import { pushSubscriptionService } from "./pushSubscriptionService"
import { makeEmployee } from "@/test/factories"
import { db } from "@/test/db/store"

/**
 * Seam D — #167's own testing decision: subscribing stores an endpoint,
 * subscribing twice from one browser does not duplicate it, unsubscribing
 * removes it.
 */
describe("pushSubscriptionService", () => {
  const subscription = (overrides = {}) => ({
    endpoint: "https://push.example/abc",
    keys: { p256dh: "p256dh-key", auth: "auth-secret" },
    ...overrides,
  })

  it("stores a new subscription for the employee", async () => {
    const employee = makeEmployee()

    await pushSubscriptionService.subscribe(employee.id, subscription())

    const rows = db.rows("push_subscriptions").filter((r) => r.employee_id === employee.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      endpoint: "https://push.example/abc",
      p256dh: "p256dh-key",
      auth: "auth-secret",
    })
  })

  it("does not duplicate a subscription re-registered from the same browser", async () => {
    const employee = makeEmployee()

    await pushSubscriptionService.subscribe(employee.id, subscription())
    await pushSubscriptionService.subscribe(employee.id, subscription({ keys: { p256dh: "new-key", auth: "new-secret" } }))

    const rows = db.rows("push_subscriptions").filter((r) => r.employee_id === employee.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].p256dh).toBe("new-key")
  })

  it("lets one employee hold subscriptions from two different browsers", async () => {
    const employee = makeEmployee()

    await pushSubscriptionService.subscribe(employee.id, subscription({ endpoint: "https://push.example/laptop" }))
    await pushSubscriptionService.subscribe(employee.id, subscription({ endpoint: "https://push.example/desktop" }))

    const rows = db.rows("push_subscriptions").filter((r) => r.employee_id === employee.id)
    expect(rows).toHaveLength(2)
  })

  it("accepts a browser PushSubscription object via toJSON()", async () => {
    const employee = makeEmployee()
    const browserShaped = {
      toJSON: () => subscription({ endpoint: "https://push.example/toJSON" }),
    }

    await pushSubscriptionService.subscribe(employee.id, browserShaped)

    const rows = db.rows("push_subscriptions").filter((r) => r.employee_id === employee.id)
    expect(rows[0].endpoint).toBe("https://push.example/toJSON")
  })

  it("removes a subscription on unsubscribe", async () => {
    const employee = makeEmployee()
    await pushSubscriptionService.subscribe(employee.id, subscription())

    await pushSubscriptionService.unsubscribe(employee.id, "https://push.example/abc")

    expect(db.rows("push_subscriptions").filter((r) => r.employee_id === employee.id)).toEqual([])
  })

  it("reports whether a subscription is stored", async () => {
    const employee = makeEmployee()
    expect(await pushSubscriptionService.isSubscribed(employee.id, "https://push.example/abc")).toBe(false)

    await pushSubscriptionService.subscribe(employee.id, subscription())

    expect(await pushSubscriptionService.isSubscribed(employee.id, "https://push.example/abc")).toBe(true)
  })
})
