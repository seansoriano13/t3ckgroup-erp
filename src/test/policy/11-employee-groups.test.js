/**
 * Issue #201 — Employee Groups against real Postgres.
 *
 * Two things only this tier can prove: that the RLS on the three group tables
 * lets every signed-in employee read and only a Super Admin write, and that
 * `employee_group_member_ids` — the function later specs' access policies call
 * — means the same people `resolvePeople` shows on screen: hand-picked members
 * plus a Team's current members, a deleted employee never.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, ensureCastLoaded, clientFor } from "./support/cast.js"
import { serviceClient } from "./support/stack.js"
import { MARKER } from "./support/rows.js"
import { canRead, tryInsert, tryUpdate, tryDelete, RLS_VIOLATION } from "./support/access.js"
import { resolveGroupMemberIds } from "@/utils/resolvePeople.js"

const svc = () => serviceClient()

let groupId
let memberRowId
let teamRowId

beforeAll(async () => {
    await ensureCastLoaded()

    const group = await svc()
        .from("employee_groups")
        .insert({ name: `${MARKER} Logistics plus Admin`, created_by: ids.superAdmin })
        .select("id")
        .single()
    if (group.error) throw new Error(group.error.message)
    groupId = group.data.id

    // Hand-picked: the Super Admin (no Sub-department) and the soft-deleted
    // employee, who must never count. Team: LOGISTICS, which is the outsider.
    const members = await svc()
        .from("employee_group_members")
        .insert([
            { group_id: groupId, employee_id: ids.superAdmin },
            { group_id: groupId, employee_id: ids.deleted },
        ])
        .select("id")
    if (members.error) throw new Error(members.error.message)
    memberRowId = members.data[0].id

    const team = await svc()
        .from("employee_group_teams")
        .insert({ group_id: groupId, team: " logistics " })
        .select("id")
        .single()
    if (team.error) throw new Error(team.error.message)
    teamRowId = team.data.id
})

afterAll(async () => {
    await svc().from("employee_groups").delete().like("name", `${MARKER}%`)
})

describe("employee_group_member_ids", () => {
    it("returns hand-picked members and Team members, excluding a deleted employee", async () => {
        const { data, error } = await svc().rpc("employee_group_member_ids", { p_group_id: groupId })
        expect(error).toBeNull()

        const resolved = data.map((row) => (typeof row === "string" ? row : Object.values(row)[0])).sort()
        expect(resolved).toEqual([ids.outsider, ids.superAdmin].sort())
        expect(resolved).not.toContain(ids.deleted)
    })

    it("gives the same answer as the resolver the screen uses", async () => {
        const { data: employees } = await svc().from("employees").select("id, sub_department, is_deleted")
        const expected = resolveGroupMemberIds(
            { employeeIds: [ids.superAdmin, ids.deleted], teams: [" logistics "] },
            employees,
        ).sort()

        const { data } = await svc().rpc("employee_group_member_ids", { p_group_id: groupId })
        const resolved = data.map((row) => (typeof row === "string" ? row : Object.values(row)[0])).sort()

        expect(resolved).toEqual(expected)
    })

    it("is callable by an ordinary signed-in employee", async () => {
        const client = await clientFor("ordinary")
        const { data, error } = await client.rpc("employee_group_member_ids", { p_group_id: groupId })
        expect(error).toBeNull()
        expect(data.length).toBe(2)
    })
})

describe("employee group tables", () => {
    const rows = () => ({
        employee_groups: groupId,
        employee_group_members: memberRowId,
        employee_group_teams: teamRowId,
    })

    it("let an ordinary employee read all three", async () => {
        const client = await clientFor("ordinary")
        for (const [table, id] of Object.entries(rows())) {
            expect(await canRead(client, table, id), table).toBe(true)
        }
    })

    it("refuse an ordinary employee inserting into any of them", async () => {
        const client = await clientFor("ordinary")

        const group = await tryInsert(client, "employee_groups", { name: `${MARKER} Self-made` })
        expect(group.ok).toBe(false)
        expect(group.code).toBe(RLS_VIOLATION)

        const member = await tryInsert(client, "employee_group_members", {
            group_id: groupId,
            employee_id: ids.ordinary,
        })
        expect(member.ok).toBe(false)
        expect(member.code).toBe(RLS_VIOLATION)

        const team = await tryInsert(client, "employee_group_teams", { group_id: groupId, team: "NGO" })
        expect(team.ok).toBe(false)
        expect(team.code).toBe(RLS_VIOLATION)
    })

    it("refuse an ordinary employee updating or deleting any of them", async () => {
        const client = await clientFor("ordinary")

        expect((await tryUpdate(client, "employee_groups", groupId, { name: `${MARKER} Hijacked` })).affected).toBe(0)
        expect((await tryUpdate(client, "employee_group_teams", teamRowId, { team: "NGO" })).affected).toBe(0)
        expect((await tryDelete(client, "employee_group_members", memberRowId)).affected).toBe(0)
        expect((await tryDelete(client, "employee_group_teams", teamRowId)).affected).toBe(0)
        expect((await tryDelete(client, "employee_groups", groupId)).affected).toBe(0)
    })

    it("refuse HR too — is_hr grants nothing here", async () => {
        const client = await clientFor("hr")
        const result = await tryInsert(client, "employee_groups", { name: `${MARKER} HR made` })
        expect(result.ok).toBe(false)
        expect(result.code).toBe(RLS_VIOLATION)
    })

    it("let a Super Admin insert, update and delete in all three", async () => {
        const client = await clientFor("superAdmin")

        const group = await tryInsert(client, "employee_groups", { name: `${MARKER} Admin made` })
        expect(group.ok, group.message).toBe(true)

        const member = await tryInsert(client, "employee_group_members", {
            group_id: group.id,
            employee_id: ids.ordinary,
        })
        expect(member.ok, member.message).toBe(true)

        const team = await tryInsert(client, "employee_group_teams", { group_id: group.id, team: "NGO" })
        expect(team.ok, team.message).toBe(true)

        expect((await tryUpdate(client, "employee_group_teams", team.id, { team: "SALES" })).affected).toBe(1)
        expect((await tryUpdate(client, "employee_groups", group.id, { description: "x" })).affected).toBe(1)
        expect((await tryDelete(client, "employee_group_members", member.id)).affected).toBe(1)
        expect((await tryDelete(client, "employee_group_teams", team.id)).affected).toBe(1)
        expect((await tryDelete(client, "employee_groups", group.id)).affected).toBe(1)
    })
})
