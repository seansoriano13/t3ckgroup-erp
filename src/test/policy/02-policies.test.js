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
 * What `sor_update`'s own USING clause names: the registrar, the deal owner,
 * either supporting salesperson and the sales director, plus anyone holding
 * is_head or is_super_admin. #293 (ADR 0021) leaves this predicate's text
 * untouched — it narrows `sor_read` only — but Postgres requires a row to
 * pass the table's SELECT policy before an UPDATE (or DELETE) may touch it at
 * all, on top of whatever the UPDATE policy's own USING allows. A Group Task
 * below documents the same mechanic. So narrowing reads narrows this set for
 * free: `subHead` matches the predicate but, with no Deal Team role or Always
 * sees grant, can no longer edit the SOR either. `MAY_EDIT_THE_SOR` is the
 * intersection actually left standing.
 */
const SOR_UPDATE_PREDICATE = ["dealOwner", "support", "head", "subHead", "superAdmin"]

/**
 * `sor_read` as of #293 (ADR 0021): the Deal Team — registrar, Deal Owner,
 * Closing Salesperson, either Support Sales, Sales Director — plus Super
 * Admins. `head` is here because the fixture below names them the seeded
 * SOR's Sales Director, a Deal Team role, not because `is_head` grants
 * anything any more. `subHead` holds only `is_head` with no role on this
 * record, which is exactly the access Heads lost. A Sales Flow's Always sees
 * list is what would put a Head or HR back; covered separately below.
 */
const MAY_READ_THE_SOR = ["dealOwner", "support", "closingSales", "head", "superAdmin"]
const MAY_NOT_READ_THE_SOR = EVERYONE.filter((k) => !MAY_READ_THE_SOR.includes(k))

const MAY_EDIT_THE_SOR = SOR_UPDATE_PREDICATE.filter((k) => MAY_READ_THE_SOR.includes(k))
const MAY_NOT_EDIT_THE_SOR = EVERYONE.filter((k) => !MAY_EDIT_THE_SOR.includes(k))

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
        closingSalesId: ids.closingSales,
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

describe("reading an SOR (#293, ADR 0021 — Deal Team plus Always sees)", () => {
    it.each(MAY_READ_THE_SOR)(
        "%s can read an SOR they are on the Deal Team for, or a Super Admin",
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

    it("a Head with no Deal Team role on the record cannot read it — Heads lost automatic access", async () => {
        const client = await clientFor("subHead")
        expect(await canRead(client, "sales_opportunities", sor)).toBe(false)
    })

    it("an HR employee with no Deal Team role on the record cannot read it — HR lost automatic access", async () => {
        const client = await clientFor("hr")
        expect(await canRead(client, "sales_opportunities", sor)).toBe(false)
    })

    it("the Closing Salesperson can read their own SOR for the first time", async () => {
        const client = await clientFor("closingSales")
        expect(await canRead(client, "sales_opportunities", sor)).toBe(true)
    })

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

describe("reading an SOR via a Sales Flow's Always sees list (#293, ADR 0021)", () => {
    let saleTypeId
    let flowId
    let stageId
    let groupId
    let flowSor

    beforeAll(async () => {
        const svc = serviceClient()

        const saleType = await svc
            .from("sale_types")
            .insert({ name: `${MARKER} Always Sees Sale Type` })
            .select("id")
            .single()
        if (saleType.error) throw new Error(`Seeding a Sale Type: ${saleType.error.message}`)
        saleTypeId = saleType.data.id

        const flow = await svc
            .from("sales_flows")
            .insert({ sale_type_id: saleTypeId })
            .select("id")
            .single()
        if (flow.error) throw new Error(`Seeding a flow: ${flow.error.message}`)
        flowId = flow.data.id

        const stage = await svc
            .from("flow_stages")
            .insert({ flow_id: flowId, name: `${MARKER} Enquiry`, sort_order: 10 })
            .select("id")
            .single()
        if (stage.error) throw new Error(`Seeding a stage: ${stage.error.message}`)
        stageId = stage.data.id

        const group = await svc
            .from("employee_groups")
            .insert({ name: `${MARKER} Always Sees Group`, created_by: ids.superAdmin })
            .select("id")
            .single()
        if (group.error) throw new Error(`Seeding an employee group: ${group.error.message}`)
        groupId = group.data.id

        const groupMember = await svc
            .from("employee_group_members")
            .insert({ group_id: groupId, employee_id: ids.leaveManager })
        if (groupMember.error) throw new Error(`Seeding a group member: ${groupMember.error.message}`)

        const access = await svc.from("flow_access_settings").insert({
            flow_id: flowId,
            always_sees: [
                { type: "employee", id: ids.hr },
                { type: "group", id: groupId },
                { type: "team", team: "LOGISTICS" },
            ],
        })
        if (access.error) throw new Error(`Seeding flow_access_settings: ${access.error.message}`)

        flowSor = await makeSor({
            registeredBy: ids.dealOwner,
            saleTypeId,
            flowStageId: stageId,
            companyName: `${MARKER} Always Sees Company`,
        })
    })

    afterAll(async () => {
        const svc = serviceClient()
        await svc.from("sales_opportunities").delete().eq("id", flowSor)
        await svc.from("flow_access_settings").delete().eq("flow_id", flowId)
        await svc.from("employee_groups").delete().eq("id", groupId)
        await svc.from("flow_stages").delete().eq("id", stageId)
        await svc.from("sales_flows").delete().eq("id", flowId)
        await svc.from("sale_types").delete().eq("id", saleTypeId)
    })

    it("an employee selector in Always sees can read every SOR of that Sale Type", async () => {
        const client = await clientFor("hr")
        expect(await canRead(client, "sales_opportunities", flowSor)).toBe(true)
    })

    it("a group selector in Always sees reaches its members", async () => {
        const client = await clientFor("leaveManager")
        expect(await canRead(client, "sales_opportunities", flowSor)).toBe(true)
    })

    it("a team selector in Always sees reaches everyone on that Sub-department", async () => {
        const client = await clientFor("outsider")
        expect(await canRead(client, "sales_opportunities", flowSor)).toBe(true)
    })

    it("an employee not named in Always sees, and not on the Deal Team, still cannot read it", async () => {
        const client = await clientFor("support")
        expect(await canRead(client, "sales_opportunities", flowSor)).toBe(false)
    })

    it("Always sees does not reach an SOR of a different Sale Type", async () => {
        const client = await clientFor("hr")
        expect(await canRead(client, "sales_opportunities", sor)).toBe(false)
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

    // #295 (ADR 0021) moved `sales_opportunity_items` off
    // `sor_can_edit_opportunity` onto the same Deal Team / Always-sees test
    // `sales_opportunities` itself now reads through — closing_sales_id
    // included, closing the child-table gap the old version of this test
    // documented as still open.
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

/** Bypasses RETURNING's SELECT filter entirely, to prove a write landed even
 *  for an actor `sor_read` (#293) no longer lets read the row back. */
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

    it("a sub-department head can no longer edit an SOR they have no Deal Team role on — #293 narrows this for free", async () => {
        // Before #293, `is_head` alone satisfied `sor_update`'s own USING
        // clause regardless of role. It still does, textually — but Postgres
        // requires a row to pass the table's SELECT policy before an UPDATE
        // may touch it at all, same as the Group Task tables below, and
        // `sor_read` (#293) no longer lets a Head with no role on the record
        // through. The predicate's text is unchanged; what it can reach is not.
        const client = await clientFor("subHead")
        const result = await tryUpdate(client, "sales_opportunities", othersSor, {
            lost_reason: "touched by a head from another department",
        })
        expect(result.affected).toBe(0)
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
