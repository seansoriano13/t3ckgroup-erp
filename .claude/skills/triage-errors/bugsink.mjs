#!/usr/bin/env node
// Read-only helper for the triage-errors skill. Talks to Bugsink with the
// BUGSINK_READ_TOKEN from .env.local (or the environment) and never prints it.
// The only thing it writes is the local decisions ledger in ./.state/.
//
//   node bugsink.mjs issues [--all] [--staging|--any-env]
//                                                undecided open production issues (--all: include
//                                                decided; --staging: staging only; --any-env: both)
//   node bugsink.mjs issue <friendly-id|uuid>    one issue: tags, latest event, stack trace
//   node bugsink.mjs decide <id> <ticket|spec|ignore|later> [note...]
//   node bugsink.mjs ledger                      everything decided so far
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "../../..")
const ledgerPath = join(here, ".state", "ledger.json")

function loadEnv() {
    const env = { ...process.env }
    const file = join(repoRoot, ".env.local")
    if (existsSync(file)) {
        for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
            if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
        }
    }
    return env
}

const env = loadEnv()
const base = (env.BUGSINK_URL || "").replace(/\/$/, "")
const token = env.BUGSINK_READ_TOKEN
if (!base || !token) {
    console.error("BUGSINK_URL and BUGSINK_READ_TOKEN must be set in .env.local. Stopping.")
    process.exit(2)
}

async function api(path) {
    const res = await fetch(`${base}/api/canonical/0${path}`, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(`Bugsink ${res.status} for ${path.split("?")[0]}`)
    const type = res.headers.get("content-type") || ""
    return type.includes("json") ? res.json() : res.text()
}

async function allPages(path) {
    const out = []
    let next = path
    for (let i = 0; next && i < 20; i++) {
        const page = await api(next)
        out.push(...(page.results ?? []))
        next = page.next ? page.next.replace(/^.*\/api\/canonical\/0/, "") : null
    }
    return out
}

const readLedger = () => (existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : {})
function writeLedger(ledger) {
    mkdirSync(dirname(ledgerPath), { recursive: true })
    writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n")
}

function commitsBehind(release) {
    if (!/^[0-9a-f]{7,40}$/.test(release || "")) return null
    try {
        return Number(execSync(`git rev-list --count ${release}..origin/staging`, { cwd: repoRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim())
    } catch {
        return null
    }
}

const [cmd, ...rest] = process.argv.slice(2)

if (cmd === "issues") {
    const showAll = rest.includes("--all")
    // Production is what real people use, so it is the default. --staging looks at
    // the single-user staging site instead; --any-env mixes both.
    const envFlag = rest.includes("--any-env") ? null : rest.includes("--staging") ? "staging" : "production"
    const ledger = readLedger()
    const filter = envFlag ? `&q=${encodeURIComponent(`environment:${envFlag}`)}` : ""
    const issues = await allPages(`/issues/?project=1&state=unresolved&sort=last_seen&order=desc${filter}`)
    const rows = []
    for (const i of issues) {
        const d = ledger[i.friendly_id]
        const grew = d && i.digested_event_count > d.eventCountAtDecision
        if (d && !grew && !showAll) continue
        rows.push({
            id: i.friendly_id,
            uuid: i.id,
            title: `${i.calculated_type}: ${i.calculated_value}`.slice(0, 160),
            where: i.transaction || null,
            events: i.digested_event_count,
            firstSeen: i.first_seen,
            lastSeen: i.last_seen,
            decided: d ? `${d.decision}${grew ? ` (came back: ${i.digested_event_count - d.eventCountAtDecision} new events)` : ""}` : null,
        })
    }
    console.log(JSON.stringify({ environment: envFlag ?? "any", count: rows.length, issues: rows }, null, 2))
} else if (cmd === "issue") {
    const id = rest[0]
    if (!id) throw new Error("usage: issue <friendly-id|uuid>")
    const issue = await api(`/issues/${encodeURIComponent(id)}/`)
    const tags = await api(`/issues/${encodeURIComponent(id)}/tags/`).catch(() => null)
    const events = await api(`/events/?issue=${encodeURIComponent(issue.id)}&order=desc`)
    const latest = events.results?.[0]
    let event = null
    let stack = null
    if (latest) {
        event = await api(`/events/${latest.id}/`)
        stack = await api(`/events/${latest.id}/stacktrace/`).catch(() => null)
    }
    const data = event?.data ?? {}
    const release = data.release ?? null
    console.log(JSON.stringify({
        id: issue.friendly_id,
        url: `${base}/issues/issue/${issue.id}/event/last/`,
        title: `${issue.calculated_type}: ${issue.calculated_value}`,
        where: issue.transaction || null,
        events: issue.digested_event_count,
        firstSeen: issue.first_seen,
        lastSeen: issue.last_seen,
        environment: data.environment ?? null,
        release,
        commitsOnStagingSinceThatBuild: commitsBehind(release),
        tags: tags ?? data.tags ?? null,
        pageUrl: data.request?.url ?? null,
        extra: data.extra ?? null,
    }, null, 2))
    console.log("\n--- latest stack trace (source-mapped when the upload worked) ---")
    console.log(typeof stack === "string" ? stack.slice(0, 6000) : "(no stack trace)")
} else if (cmd === "decide") {
    const [id, decision, ...note] = rest
    if (!id || !["ticket", "spec", "ignore", "later"].includes(decision)) {
        throw new Error("usage: decide <friendly-id> <ticket|spec|ignore|later> [note...]")
    }
    const issue = await api(`/issues/${encodeURIComponent(id)}/`)
    const ledger = readLedger()
    ledger[issue.friendly_id] = {
        decision,
        note: note.join(" "),
        decidedAt: new Date().toISOString(),
        eventCountAtDecision: issue.digested_event_count,
        title: `${issue.calculated_type}: ${issue.calculated_value}`.slice(0, 160),
    }
    writeLedger(ledger)
    console.log(`recorded ${issue.friendly_id} -> ${decision}`)
} else if (cmd === "ledger") {
    console.log(JSON.stringify(readLedger(), null, 2))
} else {
    console.error("usage: bugsink.mjs issues [--all] | issue <id> | decide <id> <ticket|spec|ignore|later> [note] | ledger")
    process.exit(1)
}
