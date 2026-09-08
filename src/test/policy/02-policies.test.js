/**
 * The policy matrix.
 *
 * For each seeded identity, what each of the four tables actually permits, for
 * each of select / insert / update / delete. Assertions are named after the
 * rule a person would recognise, not after the policy that implements it,
 * because the policy name is the thing most likely to change while the rule
 * stays the same.
 *
 * These tests describe the system **as it is today**, including where that is
 * wrong. Several assert behaviour that #129, #131 and #176 will change — they
 * are named for the issue that will change them, so that work fails here first
 * and rewriting the assertion is how the change gets recorded.
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
 * has nothing to do with the record appears here.
 */
const MAY_EDIT_THE_SOR = ["dealOwner", "support", "head", "subHead", "superAdmin"]
const MAY_NOT_EDIT_THE_SOR = EVERYONE.filter((k) => !MAY_EDIT_THE_SOR.includes(k))

let sor // registered by dealOwner, supported by `support`, directed by `head`
let othersSor // registered by outsider, nobody else attached
let task
let group

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
})

afterAll(async () => {
    const svc = serviceClient()
    await svc.from("committee_task_members").delete().eq("committee_task_id", group.taskId)
    await svc.from("committee_tasks").delete().eq("id", group.taskId)
    await svc.from("tasks").delete().eq("id", task)
    await svc.from("sales_opportunities").delete().in("id", [sor, othersSor])
})

// ===========================================================================
// Is the table protected at all?
// ===========================================================================

describe("a table that is supposed to be protected", () => {
    it.each([["sales_opportunities"], ["committee_tasks"], ["committee_task_members"]])(
        "has row level security turned on and at least one policy: %s",
        async (table) => {
            const { enabled, policies } = await rlsStatus(table)
            expect(enabled, `${table} has RLS switched off`).toBe(true)
            expect(
                policies,
                `${table} has RLS on but no policies, so it denies everything`,
            ).toBeGreaterThan(0)
        },
    )
})

// ===========================================================================
// SOR
// ===========================================================================

describe("reading an SOR", () => {
    it.each(EVERYONE)(
        "%s can read every SOR in the company, whether or not they are on it (#129 narrows this)",
        async (key) => {
            // `sor_read` is `using (true)`. The department filtering a
            // salesperson sees on the Register happens in their browser, so
            // every record in the company is delivered to every employee.
            const client = await clientFor(key)
            expect(await canRead(client, "sales_opportunities", sor)).toBe(true)
            expect(await canRead(client, "sales_opportunities", othersSor)).toBe(true)
        },
    )

    it("a caller who is not signed in can read no SOR at all", async () => {
        // The one refusal `sor_read` makes: it is granted to `authenticated`,
        // not to `public`.
        expect(await canRead(anonymousClient(), "sales_opportunities", sor)).toBe(false)
    })
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
// Tasks — the table with no protection at all
// ===========================================================================

describe("tasks, which has no row level security whatsoever (#131)", () => {
    it("has RLS switched off and not one policy, unlike production", async () => {
        const { enabled, policies } = await rlsStatus("tasks")
        expect(enabled).toBe(false)
        expect(policies).toBe(0)
    })

    // The three below demonstrate the consequence rather than describing it.
    // They are the loudest form the requirement can take: not "this table is
    // unprotected" but "here is a stranger reading, rewriting and destroying
    // another employee's task". When #131 lands they fail, and the failure is
    // the signal to rewrite them as a real matrix.

    it.each(EVERYONE)("%s can read another employee's task", async (key) => {
        const client = await clientFor(key)
        expect(await canRead(client, "tasks", task)).toBe(true)
    })

    it("a stranger can rewrite another employee's task", async () => {
        const client = await clientFor("outsider")
        const result = await tryUpdate(client, "tasks", task, {
            task_description: `${MARKER} rewritten by a stranger`,
        })
        expect(result.affected).toBe(1)
    })

    it("a stranger can delete another employee's task outright", async () => {
        const doomed = await makeTask({ loggedBy: ids.ordinary })
        const client = await clientFor("outsider")
        const result = await tryDelete(client, "tasks", doomed)
        expect(result.affected).toBe(1)
    })

    it("a stranger can log a task in another employee's name", async () => {
        const client = await clientFor("outsider")
        const result = await tryInsert(client, "tasks", {
            logged_by: ids.ordinary,
            task_description: `${MARKER} logged by somebody else`,
        })
        expect(result.ok).toBe(true)
        await serviceClient().from("tasks").delete().eq("id", result.id)
    })
})

// ===========================================================================
// Group Tasks
// ===========================================================================

describe("Group Tasks", () => {
    it.each(EVERYONE)("%s can read any Group Task in the company", async (key) => {
        const client = await clientFor(key)
        expect(await canRead(client, "committee_tasks", group.taskId)).toBe(true)
    })

    it.each(EVERYONE)(
        "%s can create a Group Task naming somebody else as its creator (#176 constrains this)",
        async (key) => {
            // The insert policy is `with check (true)`. Nothing stops a Group
            // Task being created in another person's name.
            const client = await clientFor(key)
            const result = await tryInsert(client, "committee_tasks", {
                title: `${MARKER} Created in another name`,
                created_by: ids.superAdmin,
            })
            expect(result.ok, result.message).toBe(true)
            await serviceClient().from("committee_tasks").delete().eq("id", result.id)
        },
    )

    it.each(EVERYONE)("%s can edit a Group Task they have no part in", async (key) => {
        const client = await clientFor(key)
        const result = await tryUpdate(client, "committee_tasks", group.taskId, {
            description: `${MARKER} edited by ${key}`,
        })
        expect(result.affected).toBe(1)
    })

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
    it.each(EVERYONE)("%s can read a membership row for a task they have no part in", async (key) => {
        const client = await clientFor(key)
        expect(await canRead(client, "committee_task_members", group.memberRowId)).toBe(true)
    })

    it.each(EVERYONE)("%s can add anybody to any Group Task", async (key) => {
        const client = await clientFor(key)
        const result = await tryInsert(client, "committee_task_members", {
            committee_task_id: group.taskId,
            employee_id: ids.deleted,
            task_description: `${MARKER} added by ${key}`,
        })
        expect(result.ok, result.message).toBe(true)
        await serviceClient().from("committee_task_members").delete().eq("id", result.id)
    })

    it.each(EVERYONE)("%s can reassign somebody else's share of a Group Task", async (key) => {
        const client = await clientFor(key)
        const result = await tryUpdate(client, "committee_task_members", group.memberRowId, {
            task_description: `${MARKER} reassigned by ${key}`,
        })
        expect(result.affected).toBe(1)
    })

    it.each(EVERYONE)("%s cannot remove a member, because no policy permits deletion", async (key) => {
        const client = await clientFor(key)
        const result = await tryDelete(client, "committee_task_members", group.memberRowId)
        expect(result.affected, `${key} removed a member`).toBe(0)
    })
})

// ===========================================================================

describe("an identity the policies cannot see", () => {
    it("a soft-deleted employee still resolves and still passes every policy", async () => {
        // `is_deleted` is an application-level filter, not a policy one. Their
        // token works and the rules treat them as staff.
        const client = await clientFor("deleted")
        expect(await canRead(client, "sales_opportunities", sor)).toBe(true)
        expect(await canRead(client, "committee_tasks", group.taskId)).toBe(true)
        expect(await canRead(client, "tasks", task)).toBe(true)
    })
})
