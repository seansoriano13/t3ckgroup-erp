/**
 * #169: the notifications table's two latent defects, proven fixed.
 *
 *   - There was no DELETE policy, so `notificationService.deleteNotification`
 *     matched zero rows, returned success, and the row came back on the next
 *     fetch. The regression test is that the row is actually gone.
 *   - The table was never added to the supabase_realtime publication in any
 *     migration, so real-time delivery depended on configuration that could
 *     not be reproduced from the repository. Asserted here after migrations
 *     have been applied, the way this tier applies them.
 *
 * Also covers the narrowed insert policy (#169) and the new push_subscriptions
 * table (#167).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus, isInRealtimePublication } from "./support/stack.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"

const EVERYONE = CAST_KEYS
const MARKER = "[policy-tier]"

let ownNotification // recipient: ordinary, sender: head
let othersNotification // recipient: outsider

beforeAll(async () => {
    await ensureCastLoaded()

    const svc = serviceClient()
    const { data, error } = await svc
        .from("notifications")
        .insert([
            {
                recipient_id: ids.ordinary,
                sender_id: ids.head,
                type: "TASK_ASSIGNED",
                title: `${MARKER} Assigned to you`,
                message: "seeded by the policy tier",
            },
            {
                recipient_id: ids.outsider,
                sender_id: ids.head,
                type: "TASK_ASSIGNED",
                title: `${MARKER} Assigned to outsider`,
                message: "seeded by the policy tier",
            },
        ])
        .select("id, recipient_id")
    if (error) throw error
    ownNotification = data.find((n) => n.recipient_id === ids.ordinary).id
    othersNotification = data.find((n) => n.recipient_id === ids.outsider).id
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("notifications").delete().in("id", [ownNotification, othersNotification])
    await svc.from("push_subscriptions").delete().in("employee_id", [ids.ordinary, ids.outsider])
})

describe("a table that is supposed to be protected", () => {
    it.each([["notifications"], ["push_subscriptions"]])(
        "has row level security turned on and at least one policy: %s",
        async (table) => {
            const { enabled, policies } = await rlsStatus(table)
            expect(enabled, `${table} has RLS switched off`).toBe(true)
            expect(policies, `${table} has RLS on but no policies`).toBeGreaterThan(0)
        },
    )
})

describe("real-time delivery is reproducible from the repository", () => {
    it("notifications is a member of the supabase_realtime publication", async () => {
        expect(await isInRealtimePublication("notifications")).toBe(true)
    })
})

describe("reading a notification", () => {
    it("the recipient can read their own notification", async () => {
        const client = await clientFor("ordinary")
        expect(await canRead(client, "notifications", ownNotification)).toBe(true)
    })

    it("nobody else can read it, including a Super Admin", async () => {
        const others = EVERYONE.filter((k) => k !== "ordinary")
        for (const key of others) {
            const client = await clientFor(key)
            expect(await canRead(client, "notifications", ownNotification), `${key} read it`).toBe(false)
        }
    })

    it("a caller who is not signed in can read none", async () => {
        expect(await canRead(anonymousClient(), "notifications", ownNotification)).toBe(false)
    })
})

describe("deleting a notification — the regression test for #169", () => {
    it("the recipient can delete their own notification, and it is actually gone", async () => {
        const svc = serviceClient()
        const { data } = await svc
            .from("notifications")
            .insert({
                recipient_id: ids.ordinary,
                type: "TASK_ASSIGNED",
                title: `${MARKER} to be deleted`,
                message: "seeded by the policy tier",
            })
            .select("id")
            .single()

        const client = await clientFor("ordinary")
        const result = await tryDelete(client, "notifications", data.id)
        expect(result.affected, "the delete matched no rows").toBe(1)

        const { data: stillThere } = await svc.from("notifications").select("id").eq("id", data.id)
        expect(stillThere).toEqual([])
    })

    it("a stranger cannot delete someone else's notification", async () => {
        const client = await clientFor("outsider")
        const result = await tryDelete(client, "notifications", ownNotification)
        expect(result.affected, "a stranger deleted it").toBe(0)

        const svc = serviceClient()
        const { data: stillThere } = await svc.from("notifications").select("id").eq("id", ownNotification)
        expect(stillThere).toHaveLength(1)
    })
})

describe("dispatching a notification — the narrowed insert policy", () => {
    // The application's own dispatch call (notificationService.createNotification)
    // never asks PostgREST for the row back, and that matters here: Postgres
    // evaluates the table's SELECT policy against an INSERT ... RETURNING, and
    // the recipient of a dispatched notification is essentially always someone
    // other than the sender — the sender cannot read the row they just wrote.
    // Requesting it back would therefore fail for a reason that has nothing to
    // do with the insert policy under test, so these two assert success the
    // same way the app actually inserts: no `.select()`.
    it("anybody can dispatch a notification naming themselves as sender", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("notifications").insert({
            recipient_id: ids.outsider,
            sender_id: ids.ordinary,
            type: "TASK_ASSIGNED",
            title: `${MARKER} from ordinary`,
            message: "sent honestly",
        })
        expect(error).toBeNull()
        await serviceClient().from("notifications").delete().eq("title", `${MARKER} from ordinary`)
    })

    it("anybody can dispatch a notification with no sender at all", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("notifications").insert({
            recipient_id: ids.outsider,
            type: "SYSTEM",
            title: `${MARKER} systemic`,
            message: "no sender",
        })
        expect(error).toBeNull()
        await serviceClient().from("notifications").delete().eq("title", `${MARKER} systemic`)
    })

    it("nobody can dispatch a notification claiming to be sent by someone else", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "notifications", {
            recipient_id: ids.outsider,
            sender_id: ids.superAdmin,
            type: "TASK_ASSIGNED",
            title: `${MARKER} impersonated`,
            message: "sent dishonestly",
        })
        expect(result.ok, "was allowed to impersonate the sender").toBe(false)
        expect(result.code).toBe(RLS_VIOLATION)
    })

    it("a caller who is not signed in cannot dispatch a notification at all", async () => {
        const result = await tryInsert(anonymousClient(), "notifications", {
            recipient_id: ids.outsider,
            type: "SYSTEM",
            title: `${MARKER} anonymous`,
            message: "should be refused",
        })
        expect(result.ok).toBe(false)
    })
})

describe("updating a notification", () => {
    it("the recipient can mark their own notification read", async () => {
        const client = await clientFor("ordinary")
        const result = await tryUpdate(client, "notifications", ownNotification, { is_read: true })
        expect(result.affected).toBe(1)
    })

    it("a stranger cannot touch someone else's notification", async () => {
        const client = await clientFor("outsider")
        const result = await tryUpdate(client, "notifications", ownNotification, { is_read: true })
        expect(result.affected).toBe(0)
    })
})

describe("push_subscriptions", () => {
    it("an employee can store a subscription for themselves", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "push_subscriptions", {
            employee_id: ids.ordinary,
            endpoint: `${MARKER}-own`,
            p256dh: "p256dh",
            auth: "auth",
        })
        expect(result.ok, result.message).toBe(true)
    })

    it("an employee cannot store a subscription in somebody else's name", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "push_subscriptions", {
            employee_id: ids.outsider,
            endpoint: `${MARKER}-impersonated`,
            p256dh: "p256dh",
            auth: "auth",
        })
        expect(result.ok, "was allowed to subscribe as somebody else").toBe(false)
    })

    it("an employee can read and delete only their own subscription", async () => {
        const svc = serviceClient()
        const { data: mine } = await svc
            .from("push_subscriptions")
            .insert({ employee_id: ids.ordinary, endpoint: `${MARKER}-read`, p256dh: "p256dh", auth: "auth" })
            .select("id")
            .single()
        const { data: theirs } = await svc
            .from("push_subscriptions")
            .insert({ employee_id: ids.outsider, endpoint: `${MARKER}-read-other`, p256dh: "p256dh", auth: "auth" })
            .select("id")
            .single()

        const client = await clientFor("ordinary")
        expect(await canRead(client, "push_subscriptions", mine.id)).toBe(true)
        expect(await canRead(client, "push_subscriptions", theirs.id)).toBe(false)

        const refused = await tryDelete(client, "push_subscriptions", theirs.id)
        expect(refused.affected).toBe(0)

        const allowed = await tryDelete(client, "push_subscriptions", mine.id)
        expect(allowed.affected).toBe(1)

        await svc.from("push_subscriptions").delete().eq("id", theirs.id)
    })
})
