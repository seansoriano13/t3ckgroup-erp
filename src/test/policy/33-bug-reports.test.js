/**
 * Bug Reports. Any employee sends one; Super Admins and holders of the Bug
 * Reports access right read them all, the sender reads their own. Readers and
 * the sender write Notes on a report through `add_bug_report_note`, each
 * notifying the other side. Sending goes through
 * `submit_bug_report`, which also notifies every reader. Resolved is flipped
 * through `set_bug_report_resolved`. Attachments live in the private
 * `bug-reports` bucket and a reader may delete them only once they are a year
 * old, after which `mark_bug_report_files_purged` empties the report's list.
 *
 * `outsider` is given the access right for this file only, so the reader here
 * is the flag and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { ids, clientFor, ensureCastLoaded } from "./support/cast.js"
import { serviceClient, sql, rlsStatus } from "./support/stack.js"
import { canRead, tryUpdate, tryDelete } from "./support/access.js"

const MARKER = "[policy-tier]"
const BUCKET = "bug-reports"
const svc = () => serviceClient()
const reportIds = []
const uploaded = []

async function submit(key, overrides = {}) {
    const client = await clientFor(key)
    const { data, error } = await client.rpc("submit_bug_report", {
        p_description: `${MARKER} The save button does nothing`,
        p_attachments: [],
        p_page_url: "/tasks",
        p_user_agent: "policy-tier",
        p_app_version: "test",
        p_environment: "local",
        ...overrides,
    })
    if (!error) reportIds.push(data)
    return { id: data, error }
}

async function upload(key, folder) {
    const client = await clientFor(key)
    const path = `${folder}/${crypto.randomUUID()}.txt`
    const { error } = await client.storage
        .from(BUCKET)
        .upload(path, new Blob(["log"], { type: "text/plain" }), { contentType: "text/plain" })
    if (!error) uploaded.push(path)
    return { path, error }
}

beforeAll(async () => {
    await ensureCastLoaded()
    const { error } = await svc().from("employees").update({ has_bug_report_access: true }).eq("id", ids.outsider)
    if (error) throw error
})

afterAll(async () => {
    await svc().from("employees").update({ has_bug_report_access: false }).eq("id", ids.outsider)
    await svc().from("notifications").delete().in("type", ["BUG_REPORT_SUBMITTED", "BUG_REPORT_NOTE"]).in("reference_id", reportIds)
    await svc().from("bug_reports").delete().in("id", reportIds)
    if (uploaded.length) await svc().storage.from(BUCKET).remove(uploaded)
})

describe("the table", () => {
    it("has row level security on", async () => {
        const { enabled, policies } = await rlsStatus("bug_reports")
        expect(enabled).toBe(true)
        expect(policies).toBeGreaterThan(0)
    })
})

describe("sending a bug report", () => {
    it("any employee can send one, filed under their own name", async () => {
        const { id, error } = await submit("ordinary")
        expect(error).toBeNull()

        const { data } = await svc().from("bug_reports").select("reporter_id, page_url, environment").eq("id", id).single()
        expect(data).toEqual({ reporter_id: ids.ordinary, page_url: "/tasks", environment: "local" })
    })

    it("refuses an empty description", async () => {
        const { error } = await submit("ordinary", { p_description: "   " })
        expect(error).not.toBeNull()
    })

    it("refuses more than 5 attachments", async () => {
        const six = Array.from({ length: 6 }, (_, i) => ({ path: `${ids.ordinary}/${i}.txt`, name: `${i}.txt` }))
        const { error } = await submit("ordinary", { p_attachments: six })
        expect(error).not.toBeNull()
    })

    it("refuses an attachment path outside the sender's own folder", async () => {
        const { error } = await submit("ordinary", {
            p_attachments: [{ path: `${ids.head}/stolen.txt`, name: "stolen.txt" }],
        })
        expect(error).not.toBeNull()
    })

    it("cannot be inserted into the table directly", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("bug_reports").insert({ reporter_id: ids.ordinary, description: `${MARKER} direct` })
        expect(error).not.toBeNull()
    })
})

describe("reading bug reports", () => {
    let id
    beforeAll(async () => {
        id = (await submit("ordinary")).id
    })

    it.each([["outsider"], ["superAdmin"]])("a reader can read them: %s", async (key) => {
        expect(await canRead(await clientFor(key), "bug_reports", id)).toBe(true)
    })

    it("the sender can read their own", async () => {
        expect(await canRead(await clientFor("ordinary"), "bug_reports", id)).toBe(true)
    })

    it.each([["head"], ["hr"]])("anyone else cannot: %s", async (key) => {
        expect(await canRead(await clientFor(key), "bug_reports", id)).toBe(false)
    })

    it("a reader cannot edit or delete one directly", async () => {
        const client = await clientFor("superAdmin")
        expect((await tryUpdate(client, "bug_reports", id, { description: "x" })).affected).toBe(0)
        expect((await tryDelete(client, "bug_reports", id)).affected).toBe(0)
    })
})

describe("notifying readers", () => {
    it("each reader gets one notification, the sender and non-readers none", async () => {
        const { id } = await submit("superAdmin")
        const { data } = await svc()
            .from("notifications")
            .select("recipient_id, sender_id")
            .eq("type", "BUG_REPORT_SUBMITTED")
            .eq("reference_id", id)
        const recipients = data.map((n) => n.recipient_id)
        expect(recipients).toContain(ids.outsider)
        expect(recipients).not.toContain(ids.superAdmin)
        expect(recipients).not.toContain(ids.ordinary)
        expect(recipients).not.toContain(ids.deleted)
        expect(new Set(recipients).size).toBe(recipients.length)
    })
})

describe("resolving", () => {
    let id
    beforeAll(async () => {
        id = (await submit("ordinary")).id
    })

    it("a reader can tick and untick Resolved", async () => {
        const client = await clientFor("outsider")
        expect((await client.rpc("set_bug_report_resolved", { p_id: id, p_resolved: true })).error).toBeNull()
        let { data } = await svc().from("bug_reports").select("resolved_at, resolved_by").eq("id", id).single()
        expect(data.resolved_at).not.toBeNull()
        expect(data.resolved_by).toBe(ids.outsider)

        expect((await client.rpc("set_bug_report_resolved", { p_id: id, p_resolved: false })).error).toBeNull()
        ;({ data } = await svc().from("bug_reports").select("resolved_at, resolved_by").eq("id", id).single())
        expect(data).toEqual({ resolved_at: null, resolved_by: null })
    })

    it("a non-reader cannot", async () => {
        const client = await clientFor("ordinary")
        expect((await client.rpc("set_bug_report_resolved", { p_id: id, p_resolved: true })).error).not.toBeNull()
    })
})

describe("notes", () => {
    let id
    beforeAll(async () => {
        id = (await submit("ordinary")).id
    })

    async function note(key, body = `${MARKER} Fixed, can you check?`) {
        const client = await clientFor(key)
        return client.rpc("add_bug_report_note", { p_report_id: id, p_body: body })
    }

    async function notified(noteBody) {
        const { data } = await svc()
            .from("notifications")
            .select("recipient_id, message")
            .eq("type", "BUG_REPORT_NOTE")
            .eq("reference_id", id)
        return data.filter((n) => n.message === noteBody).map((n) => n.recipient_id)
    }

    it("a reader's note notifies the sender only", async () => {
        const body = `${MARKER} reader note`
        expect((await note("outsider", body)).error).toBeNull()
        expect(await notified(body)).toEqual([ids.ordinary])
    })

    it("the sender's reply notifies every reader, not the sender", async () => {
        const body = `${MARKER} sender reply`
        expect((await note("ordinary", body)).error).toBeNull()
        const recipients = await notified(body)
        expect(recipients).toContain(ids.outsider)
        expect(recipients).toContain(ids.superAdmin)
        expect(recipients).not.toContain(ids.ordinary)
    })

    it("anyone else cannot write one", async () => {
        expect((await note("head")).error).not.toBeNull()
    })

    it("refuses an empty note", async () => {
        expect((await note("ordinary", "   ")).error).not.toBeNull()
    })

    it("cannot be inserted directly", async () => {
        const client = await clientFor("ordinary")
        const { error } = await client.from("bug_report_notes").insert({ report_id: id, author_id: ids.ordinary, body: "x" })
        expect(error).not.toBeNull()
    })

    it("the thread is read by readers and the sender, no one else", async () => {
        const read = async (key) => (await (await clientFor(key)).from("bug_report_notes").select("id").eq("report_id", id)).data
        expect((await read("ordinary")).length).toBeGreaterThan(0)
        expect((await read("outsider")).length).toBeGreaterThan(0)
        expect(await read("head")).toEqual([])
    })

    it("Resolved and Reopened land in the thread once per change", async () => {
        const reader = await clientFor("outsider")
        await reader.rpc("set_bug_report_resolved", { p_id: id, p_resolved: true })
        await reader.rpc("set_bug_report_resolved", { p_id: id, p_resolved: true })
        await reader.rpc("set_bug_report_resolved", { p_id: id, p_resolved: false })
        const { data } = await svc()
            .from("bug_report_notes")
            .select("kind, author_id")
            .eq("report_id", id)
            .neq("kind", "note")
            .order("created_at")
        expect(data).toEqual([
            { kind: "resolved", author_id: ids.outsider },
            { kind: "reopened", author_id: ids.outsider },
        ])
    })
})

describe("attachments", () => {
    it("an employee can upload into their own folder only", async () => {
        expect((await upload("ordinary", ids.ordinary)).error).toBeNull()
        expect((await upload("ordinary", ids.head)).error).not.toBeNull()
    })

    it("a reader and the sender can open an attachment, anyone else cannot", async () => {
        const { path } = await upload("ordinary", ids.ordinary)
        const reader = await clientFor("outsider")
        expect((await reader.storage.from(BUCKET).createSignedUrl(path, 60)).error).toBeNull()
        const sender = await clientFor("ordinary")
        expect((await sender.storage.from(BUCKET).createSignedUrl(path, 60)).error).toBeNull()
        const other = await clientFor("head")
        expect((await other.storage.from(BUCKET).createSignedUrl(path, 60)).error).not.toBeNull()
    })

    it("a reader can delete a file only once it is a year old", async () => {
        const { path } = await upload("ordinary", ids.ordinary)
        const reader = await clientFor("outsider")

        const fresh = await reader.storage.from(BUCKET).remove([path])
        expect(fresh.data).toEqual([])

        await sql().query(
            "update storage.objects set created_at = now() - interval '366 days' where bucket_id = $1 and name = $2",
            [BUCKET, path],
        )
        const old = await reader.storage.from(BUCKET).remove([path])
        expect(old.data?.map((o) => o.name)).toEqual([path])
    })
})

describe("purging a year-old report's files", () => {
    it("empties the attachment list of a report over a year old, for a reader", async () => {
        const { id } = await submit("ordinary", {
            p_attachments: [{ path: `${ids.ordinary}/old.txt`, name: "old.txt", type: "text/plain", bytes: 3 }],
        })
        const reader = await clientFor("outsider")

        expect((await reader.rpc("mark_bug_report_files_purged", { p_id: id })).error).not.toBeNull()

        await sql().query("update public.bug_reports set created_at = now() - interval '366 days' where id = $1", [id])
        expect((await (await clientFor("ordinary")).rpc("mark_bug_report_files_purged", { p_id: id })).error).not.toBeNull()
        expect((await reader.rpc("mark_bug_report_files_purged", { p_id: id })).error).toBeNull()

        const { data } = await svc().from("bug_reports").select("attachments, attachments_purged_at").eq("id", id).single()
        expect(data.attachments).toEqual([])
        expect(data.attachments_purged_at).not.toBeNull()
    })
})
