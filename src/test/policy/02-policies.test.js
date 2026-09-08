/**
 * The policy matrix.
 *
 * For each seeded identity, what each of the tables actually permits, for
 * each of select / insert / update / delete. Assertions are named after the
 * rule a person would recognise, not after the policy that implements it,
 * because the policy name is the thing most likely to change while the rule
 * stays the same.
 *
 * #129, #130 and #131 narrowed sales_opportunities, tasks and committee_tasks
 * (+ member rows) from "readable/writable by anyone authenticated" to real
 * rules. This file now describes those rules as they are, not as they used
 * to be — the git history is where the "before" shape lives if it is needed.
 *
 * Vocabulary follows CONTEXT.md: an SOR, a Company, a Group Task.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { CAST_KEYS, ids, clientFor, anonymousClient, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, rlsStatus } from "./support/stack.js"
import { makeSor, makeTask, makeGroupTask, sorPayload, MARKER } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"

/** Everyone the fixture signs in. */
const EVERYONE = CAST_KEYS

/**
 * Who `sor_update` lets through on the seeded SOR. The registrar, the deal
 * owner, either supporting salesperson and the sales director, plus anyone
 * holding is_head or is_super_admin — which is why a sub-department head who
 * has nothing to do with the record appears here. #130 reuses this exact set,
 * plus HR, as the read predicate.
 */
const MAY_EDIT_THE_SOR = ["dealOwner", "support", "head", "subHead", "superAdmin"]
const MAY_NOT_EDIT_THE_SOR = EVERYONE.filter((k) => !MAY_EDIT_THE_SOR.includes(k))

/** `sor_read` is the edit predicate plus HR, stated explicitly. */
const MAY_READ_THE_SOR = [...MAY_EDIT_THE_SOR, "hr"]
const MAY_NOT_READ_THE_SOR = EVERYONE.filter((k) => !MAY_READ_THE_SOR.includes(k))

/** Who `committee_task_visible` lets through on the seeded Group Task: its
 * creator, its one named member, and a Super Admin. */
const MAY_SEE_THE_GROUP_TASK = ["ordinary", "support", "superAdmin"]
const MAY_NOT_SEE_THE_GROUP_TASK = EVERYONE.filter((k) => !MAY_SEE_THE_GROUP_TASK.includes(k))

let sor // registered by dealOwner, supported by `support`, directed by `head`
let othersSor // registered by outsider, nobody else attached
let task // logged by `ordinary`, reported to `subHead`
let group // created by `ordinary`, with `support` as its one member

// Attached entirely to the soft-deleted cast member, so a policy that treats
// them as ordinary staff — rather than as absent — can be proven positively,
// not just by elimination.
let deletedSor
let deletedTask
let deletedGroup

beforeAll(async () => {
    await ensureCastLoaded()

    sor = await makeSor({
        registeredBy: ids.dealOwner,
        dealOwnerId: ids.dealOwner,
        supportSales1Id: ids.support,
        salesDirectorId: ids.head,
    })
    othersSor = await makeSor({
        registeredBy: ids.outsider,
        companyName: `${MARKER} Unrelated Company`,
    })
    task = await makeTask({ loggedBy: ids.ordinary, reportedTo: ids.subHead })
    group = await makeGroupTask({ createdBy: ids.ordinary, memberId: ids.support })

    deletedSor = await makeSor({
        registeredBy: ids.deleted,
        dealOwnerId: ids.deleted,
        companyName: `${MARKER} Former Employee's Company`,
    })
    deletedTask = await makeTask({ loggedBy: ids.deleted })
    deletedGroup = await makeGroupTask({ createdBy: ids.deleted })
})

afterAll(async () => {
    const svc = serviceClient()
    await svc
        .from("committee_task_members")
        .delete()
        .in("committee_task_id", [group.taskId, deletedGroup.taskId])
    await svc.from("committee_tasks").delete().in("id", [group.taskId, deletedGroup.taskId])
    await svc.from("tasks").delete().in("id", [task, deletedTask])
    await svc.from("sales_opportunities").delete().in("id", [sor, othersSor, deletedSor])
})

// ===========================================================================
// Is the table protected at all?
// ===========================================================================

describe("a table that is supposed to be protected", () => {
    it.each([
        ["sales_opportunities"],
        ["sales_opportunity_members"],
        ["committee_tasks"],
        ["committee_task_members"],
        ["tasks"],
        ["task_activity"],
    ])("has row level security turned on and at least one policy: %s", async (table) => {
        const { enabled, policies } = await rlsStatus(table)
        expect(enabled, `${table} has RLS switched off`).toBe(true)
        expect(
            policies,
            `${table} has RLS on but no policies, so it denies everything`,
        ).toBeGreaterThan(0)
    })
})

// ===========================================================================
// SOR
// ===========================================================================

describe("reading an SOR", () => {
    it.each(MAY_READ_THE_SOR)(
        "%s can read an SOR they are attached to, oversee, or hold HR access to",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "sales_opportunities", sor)).toBe(true)
        },
    )

    it.each(MAY_NOT_READ_THE_SOR)(
        "%s cannot read an SOR they have nothing to do with",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "sales_opportunities", sor)).toBe(false)
        },
    )

    it("whoever registered an SOR can still read it after handing it over", async () => {
        const client = await clientFor("outsider")
        expect(await canRead(client, "sales_opportunities", othersSor)).toBe(true)
    })

    it("a salesperson cannot read a deal they have nothing to do with, even one in their own department", async () => {
        const client = await clientFor("dealOwner")
        expect(await canRead(client, "sales_opportunities", othersSor)).toBe(false)
    })

    it("a caller who is not signed in can read no SOR at all", async () => {
        expect(await canRead(anonymousClient(), "sales_opportunities", sor)).toBe(false)
    })
})

describe("reading an SOR's items through an embedded select", () => {
    // The Register and its details modal never `select` an SOR and its items
    // as two separate queries; they always embed the child inside the
    // parent's own select, the way the application actually reads it. A
    // policy proven only against a direct query on the child table could
    // still be wrong here if PostgREST's embedding resolved differently.
    let itemId

    beforeAll(async () => {
        const { data, error } = await serviceClient()
            .from("sales_opportunity_items")
            .insert({ opportunity_id: sor, product_name: `${MARKER} Rope` })
            .select("id")
            .single()
        if (error) throw error
        itemId = data.id
    })

    afterAll(async () => {
        await serviceClient().from("sales_opportunity_items").delete().eq("id", itemId)
    })

    it.each(MAY_READ_THE_SOR)(
        "%s sees the item embedded in an SOR they may read",
        async (key) => {
            const client = await clientFor(key)
            const { data, error } = await client
                .from("sales_opportunities")
                .select("id, sales_opportunity_items(id)")
                .eq("id", sor)
            expect(error).toBeNull()
            expect(data[0]?.sales_opportunity_items.map((i) => i.id)).toContain(itemId)
        },
    )

    it.each(MAY_NOT_READ_THE_SOR)(
        "%s gets neither the SOR nor its item through an embedded select",
        async (key) => {
            const client = await clientFor(key)
            const { data, error } = await client
                .from("sales_opportunities")
                .select("id, sales_opportunity_items(id)")
                .eq("id", sor)
            expect(error).toBeNull()
            expect(data).toEqual([])
        },
    )
})

describe("registering an SOR", () => {
    it.each(EVERYONE)("%s can register an SOR in their own name", async (key) => {
        const client = await clientFor(key)
        const result = await tryInsert(client, "sales_opportunities", sorPayload(ids[key]))
        expect(result.ok, `${key} was refused: ${result.message}`).toBe(true)
        await serviceClient().from("sales_opportunities").delete().eq("id", result.id)
    })

    it.each(EVERYONE)("%s cannot register an SOR in somebody else's name", async (key) => {
        const impersonated = key === "superAdmin" ? ids.ordinary : ids.superAdmin
        const client = await clientFor(key)
        const result = await tryInsert(client, "sales_opportunities", sorPayload(impersonated))
        expect(result.ok, `${key} was allowed to register in another name`).toBe(false)
        expect(result.code).toBe(RLS_VIOLATION)
    })

    it("a caller who is not signed in cannot register an SOR", async () => {
        const result = await tryInsert(
            anonymousClient(),
            "sales_opportunities",
            sorPayload(ids.ordinary),
        )
        expect(result.ok).toBe(false)
    })
})

describe("editing an SOR", () => {
    it.each(MAY_EDIT_THE_SOR)("%s can edit an SOR they are attached to or oversee", async (key) => {
        const client = await clientFor(key)
        const result = await tryUpdate(client, "sales_opportunities", sor, {
            lost_reason: `touched by ${key}`,
        })
        expect(result.affected, `${key} was refused`).toBe(1)
    })

    it.each(MAY_NOT_EDIT_THE_SOR)("%s cannot edit an SOR they are not attached to", async (key) => {
        const client = await clientFor(key)
        const result = await tryUpdate(client, "sales_opportunities", sor, {
            lost_reason: `touched by ${key}`,
        })
        expect(result.affected, `${key} was allowed to edit`).toBe(0)
    })

    it("a sub-department head can edit any SOR in the company, including one from another department", async () => {
        // `is_head` is not scoped to a department anywhere in the policy, so a
        // team lead in Sales can edit an Operations record. #129 leaves this
        // as it is; narrowing it needs the departments table that is deferred.
        const client = await clientFor("subHead")
        const result = await tryUpdate(client, "sales_opportunities", othersSor, {
            lost_reason: "touched by a head from another department",
        })
        expect(result.affected).toBe(1)
    })

    it("whoever registered an SOR keeps the ability to edit it after handing it over", async () => {
        const client = await clientFor("outsider")
        const result = await tryUpdate(client, "sales_opportunities", othersSor, {
            lost_reason: "the registrar keeps the key",
        })
        expect(result.affected).toBe(1)
    })
})

describe("deleting an SOR", () => {
    it.each(EVERYONE)("%s cannot delete an SOR, because no policy permits deletion", async (key) => {
        const client = await clientFor(key)
        const result = await tryDelete(client, "sales_opportunities", othersSor)
        expect(result.affected, `${key} deleted an SOR`).toBe(0)
    })
})

// ===========================================================================
// Tasks — narrowed by #131, but reads stay as open as production's own policy
// ===========================================================================

describe("tasks", () => {
    it.each(EVERYONE)(
        "%s can read another employee's task, because task reads are open, matching production",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "tasks", task)).toBe(true)
        },
    )

    it("a stranger cannot rewrite another employee's task", async () => {
        const client = await clientFor("outsider")
        const result = await tryUpdate(client, "tasks", task, {
            task_description: `${MARKER} rewritten by a stranger`,
        })
        expect(result.affected, "a stranger was allowed to rewrite it").toBe(0)
    })

    it("the person who logged a task can still update it", async () => {
        const client = await clientFor("ordinary")
        const result = await tryUpdate(client, "tasks", task, {
            task_description: `${MARKER} updated by its own logger`,
        })
        expect(result.affected).toBe(1)
    })

    it.each(["head", "hr", "superAdmin"])(
        "%s can update a task logged by somebody else",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryUpdate(client, "tasks", task, {
                task_description: `${MARKER} updated by ${key}`,
            })
            expect(result.affected, `${key} was refused`).toBe(1)
        },
    )

    it("a stranger cannot delete another employee's task, because no policy permits deletion", async () => {
        const doomed = await makeTask({ loggedBy: ids.ordinary })
        const client = await clientFor("outsider")
        const result = await tryDelete(client, "tasks", doomed)
        expect(result.affected, "a stranger deleted it").toBe(0)
        await serviceClient().from("tasks").delete().eq("id", doomed)
    })

    it("a stranger cannot log a task in another employee's name", async () => {
        const client = await clientFor("outsider")
        const result = await tryInsert(client, "tasks", {
            logged_by: ids.ordinary,
            task_description: `${MARKER} logged by somebody else`,
        })
        expect(result.ok, "a stranger was allowed to log it").toBe(false)
    })

    it("anybody can log a task in their own name", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "tasks", {
            logged_by: ids.ordinary,
            task_description: `${MARKER} logged by its own owner`,
        })
        expect(result.ok, result.message).toBe(true)
        await serviceClient().from("tasks").delete().eq("id", result.id)
    })

    it.each(["head", "hr", "superAdmin"])(
        "%s can log a task in somebody else's name",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryInsert(client, "tasks", {
                logged_by: ids.ordinary,
                task_description: `${MARKER} logged on somebody else's behalf`,
            })
            expect(result.ok, result.message).toBe(true)
            await serviceClient().from("tasks").delete().eq("id", result.id)
        },
    )
})

// ===========================================================================
// Group Tasks — visibility and creation narrowed by #131
// ===========================================================================

describe("Group Tasks", () => {
    it.each(MAY_SEE_THE_GROUP_TASK)(
        "%s can read a Group Task they created, belong to, or administer",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "committee_tasks", group.taskId)).toBe(true)
        },
    )

    it.each(MAY_NOT_SEE_THE_GROUP_TASK)(
        "%s cannot read a Group Task they have no part in",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "committee_tasks", group.taskId)).toBe(false)
        },
    )

    it("anybody can create a Group Task in their own name", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "committee_tasks", {
            title: `${MARKER} Created honestly`,
            created_by: ids.ordinary,
        })
        expect(result.ok, result.message).toBe(true)
        await serviceClient().from("committee_tasks").delete().eq("id", result.id)
    })

    it.each(EVERYONE)(
        "%s cannot create a Group Task naming somebody else as its creator",
        async (key) => {
            // The insert policy used to be `with check (true)`. Nothing stopped
            // a Group Task being created in another person's name.
            const impersonated = key === "superAdmin" ? ids.ordinary : ids.superAdmin
            const client = await clientFor(key)
            const result = await tryInsert(client, "committee_tasks", {
                title: `${MARKER} Created in another name`,
                created_by: impersonated,
            })
            expect(result.ok, `${key} was allowed to create it in another name`).toBe(false)
        },
    )

    it.each(MAY_SEE_THE_GROUP_TASK)("%s can edit a Group Task they created, belong to, or administer", async (key) => {
        // #131 scopes read and insert only; the update policy itself stays
        // `using (true)`, unnarrowed. It does not need to change: Postgres
        // requires a row to be visible under the table's SELECT policy before
        // an UPDATE can touch it at all, on top of whatever the UPDATE
        // policy's own USING clause allows. Narrowing reads narrowed writes
        // for free, for anyone the read policy no longer lets through.
        const client = await clientFor(key)
        const result = await tryUpdate(client, "committee_tasks", group.taskId, {
            description: `${MARKER} edited by ${key}`,
        })
        expect(result.affected).toBe(1)
    })

    it.each(MAY_NOT_SEE_THE_GROUP_TASK)(
        "%s cannot edit a Group Task they cannot even see, though the update policy alone would have let them",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryUpdate(client, "committee_tasks", group.taskId, {
                description: `${MARKER} edited by ${key}`,
            })
            expect(result.affected, `${key} was allowed to edit it`).toBe(0)
        },
    )

    it.each(EVERYONE)(
        "%s cannot delete a Group Task, because no policy permits deletion",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryDelete(client, "committee_tasks", group.taskId)
            expect(result.affected, `${key} deleted a Group Task`).toBe(0)
        },
    )

    it("a caller who is not signed in can neither read nor edit a Group Task", async () => {
        const anon = anonymousClient()
        expect(await canRead(anon, "committee_tasks", group.taskId)).toBe(false)
        const result = await tryUpdate(anon, "committee_tasks", group.taskId, {
            description: `${MARKER} anonymous`,
        })
        expect(result.affected).toBe(0)
    })
})

describe("Group Task members", () => {
    it.each(MAY_SEE_THE_GROUP_TASK)(
        "%s can read a membership row for a Group Task they created, belong to, or administer",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "committee_task_members", group.memberRowId)).toBe(true)
        },
    )

    it.each(MAY_NOT_SEE_THE_GROUP_TASK)(
        "%s cannot read a membership row for a Group Task they have no part in",
        async (key) => {
            const client = await clientFor(key)
            expect(await canRead(client, "committee_task_members", group.memberRowId)).toBe(false)
        },
    )

    it("the creator of a Group Task can add a member to it", async () => {
        const client = await clientFor("ordinary")
        const result = await tryInsert(client, "committee_task_members", {
            committee_task_id: group.taskId,
            employee_id: ids.deleted,
            task_description: `${MARKER} added by the creator`,
        })
        expect(result.ok, result.message).toBe(true)
        await serviceClient().from("committee_task_members").delete().eq("id", result.id)
    })

    it.each(["outsider", "support", "hr", "leaveManager"])(
        "%s cannot add anybody to a Group Task they did not create",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryInsert(client, "committee_task_members", {
                committee_task_id: group.taskId,
                employee_id: ids.deleted,
                task_description: `${MARKER} added by ${key}`,
            })
            expect(result.ok, `${key} was allowed to add a member to somebody else's Group Task`).toBe(
                false,
            )
        },
    )

    it("a Super Admin can add anybody to any Group Task", async () => {
        const client = await clientFor("superAdmin")
        const result = await tryInsert(client, "committee_task_members", {
            committee_task_id: group.taskId,
            employee_id: ids.deleted,
            task_description: `${MARKER} added by a Super Admin`,
        })
        expect(result.ok, result.message).toBe(true)
        await serviceClient().from("committee_task_members").delete().eq("id", result.id)
    })

    it.each(MAY_SEE_THE_GROUP_TASK)("%s can reassign somebody else's share of a Group Task", async (key) => {
        // The update policy on committee_task_members is unchanged. As with
        // committee_tasks above, PostgreSQL still requires the row to be
        // visible under the (now narrowed) read policy before the update can
        // touch it, so this table is narrowed for free too.
        const client = await clientFor(key)
        const result = await tryUpdate(client, "committee_task_members", group.memberRowId, {
            task_description: `${MARKER} reassigned by ${key}`,
        })
        expect(result.affected).toBe(1)
    })

    it.each(MAY_NOT_SEE_THE_GROUP_TASK)(
        "%s cannot reassign a member row for a Group Task they cannot even see",
        async (key) => {
            const client = await clientFor(key)
            const result = await tryUpdate(client, "committee_task_members", group.memberRowId, {
                task_description: `${MARKER} reassigned by ${key}`,
            })
            expect(result.affected, `${key} was allowed to reassign it`).toBe(0)
        },
    )

    it.each(EVERYONE)("%s cannot remove a member, because no policy permits deletion", async (key) => {
        const client = await clientFor(key)
        const result = await tryDelete(client, "committee_task_members", group.memberRowId)
        expect(result.affected, `${key} removed a member`).toBe(0)
    })
})

// ===========================================================================

describe("an identity the policies cannot see", () => {
    it("a soft-deleted employee still resolves and still passes every policy for records attached to them", async () => {
        // `is_deleted` is an application-level filter, not a policy one. Their
        // token works and the rules treat them as staff, not as absent.
        const client = await clientFor("deleted")
        expect(await canRead(client, "sales_opportunities", deletedSor)).toBe(true)
        expect(await canRead(client, "tasks", deletedTask)).toBe(true)
        expect(await canRead(client, "committee_tasks", deletedGroup.taskId)).toBe(true)
    })

    it("a soft-deleted employee is still refused a record they have nothing to do with", async () => {
        const client = await clientFor("deleted")
        expect(await canRead(client, "sales_opportunities", sor)).toBe(false)
        expect(await canRead(client, "committee_tasks", group.taskId)).toBe(false)
    })
})
