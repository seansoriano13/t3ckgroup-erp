#!/usr/bin/env node
/**
 * Builds the Release Notes demo SOR on staging: a Scratch SOR, on a copy of
 * the Government flow, carrying every kind of data the SOR window can show,
 * so the deck can open it and the room can click anything in it (ADR 0022's
 * live-sample note).
 *
 * Add-only. Nothing is ever deleted or overwritten:
 *
 *  - "ZZ Demo — Government" is a copy of Government's canvas (Stages, edges,
 *    Actions, Conditions, Fields, Follow-ups, access, every Flow Snapshot).
 *    Its ids are derived from Government's (md5), so a re-run finds the copy
 *    it made before and only adds rows Government has gained since.
 *    Government itself is only read.
 *  - Every person the copy or the SOR names is swapped for one of the demo
 *    people below: a live click on the demo SOR (a move firing a Group Task,
 *    a Revert notifying whoever the move notified) reaches only them, never
 *    real staff. Employee Groups are swapped for "ZZ Demo — …" copies.
 *  - Each run creates a NEW Scratch SOR; the deck opens the newest. A demo
 *    consumed on stage (reverted, kept, removed) is left as it is.
 *
 * The SOR is S06048's real path through Government up to For Bidding: its
 * Stage moves run through the real `record_stage_visit` and
 * `close_stage_participant_windows` triggers (so visits, tasks on hold and
 * closed access windows are what the app itself makes), and the rows its
 * Stage Actions wrote on each visit (Group Tasks and members, action runs,
 * access windows, Stage Field answers, condition ticks) are copied onto the
 * matching new visit before the next move. The client and reference in the
 * text, every person (by id), the documents and the Stage Field answers are
 * replaced; the timeline is stretched from S06048's 51 minutes to three weeks
 * ending yesterday. The Stage moves' notes are S06048's, not re-written.
 *
 * Parked on For Bidding with a saved Stage Field there, so Revert to last
 * stage asks Keep progress / Remove progress, and moving back to For Bidding
 * afterwards asks Resume / Start fresh.
 *
 * Usage:
 *   node scripts/seed-release-demo.mjs            # rehearsal, rolls back
 *   node scripts/seed-release-demo.mjs --apply    # commits
 *   node scripts/seed-release-demo.mjs --local --apply   # the `supabase start` stack
 *
 * Targets staging (STAGING_DB_URL from .env.local or the environment);
 * `--local` targets the local stack, which needs `pnpm db:reset` first so the
 * demo people, Government and S06048 exist there.
 */
import pg from "pg"
import { randomUUID } from "crypto"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs"
import { readFlowBundle, FLOW_TABLES } from "./lib/flowBackup.mjs"
import { derivedId, collectUuids, remap } from "./lib/releaseDemo.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const SOURCE_SALE_TYPE = "Government"
const DEMO_SALE_TYPE = "ZZ Demo — Government"
const SOURCE_SOR_ID = "59f57f30-0606-4680-8df3-3e8c7c0bcc1d" // S06048, the richest Government SOR on staging
const SOURCE_REFERENCE = "S06048"
const SOURCE_CLIENT = "Quezon City Disaster Risk Reduction and Management Office (DRRMO)"
/** The source's visits up to and including For Bidding; its 7th (Bid Submitted) is left out. */
const PARK_AT_SEQUENCE = 6
/** The SOR whose catalogue lines pad the Product List (S06719, 45 real Odoo lines). */
const ITEM_DONOR_ID_REFERENCE = "S06719"

/**
 * Stand-ins for every real person, looked up by email. Order matters: the
 * Deal Team takes the first four, and real people are dealt out in this order.
 */
const DEMO_PEOPLE = [
  "qa401.o@t3ck.test", // Deal Owner
  "qa401.a@t3ck.test", // Support Sales
  "qa401.sa@t3ck.test", // Sales Director
  "tggroup.itdept@gmail.com", // Closing Salesperson
  "qa401.d@t3ck.test",
  "qa401.e@t3ck.test",
  "qa401.p@t3ck.test",
  "arkadatax03@gmail.com",
]

const DEMO = {
  client: "Province of Sierra Alta — Provincial Disaster Risk Reduction and Management Office (PDRRMO)",
  contact: "Engr. Liza M. Ramos",
  project: "Rescue helmets, headlamps and extrication tools for municipal response teams",
  leadSource: "DRRM",
  projectType: "SSP",
}

const DOC = (name) => `/release-notes/demo/${name}.pdf`
/** Condition evidence and chat attachments point at harmless files the app itself serves. */
const ATTACHMENT_FOR = {
  ITB: DOC("invitation-to-bid"),
  "BIDDING DOCS": DOC("bidding-documents"),
  "PRICE SCHEDULE / PRICE OFFER": DOC("price-schedule"),
}

/** Stage Field answers, by label: the source's were live Google sign-in links. */
const FIELD_ANSWERS = {
  "Project GS": "https://docs.google.com/spreadsheets/d/demo-sierra-alta-project",
  "Brochure GDRIVE": "https://drive.google.com/drive/folders/demo-sierra-alta-brochures",
  "GS 1 CRM GDrive": "https://drive.google.com/drive/folders/demo-sierra-alta-pms",
  "Mode of Pre Bid": "Online",
  Representative: "Engr. Paolo Villanueva",
  Bidder: "T3CK Trading",
  "Purchasing Involved": "Yes — local sourcing for the headlamps; helmets from stock",
}

const CHAT = [
  { at: 0.12, by: 0, text: "Client confirmed the ABC is ₱4.49M. PR attached once we get it from the BAC secretariat." },
  { at: 0.46, by: 1, text: "Specs matched against the TOR — headlamp lumens need the Pro X, the standard one falls short." },
  { at: 0.71, by: 4, text: "Pre-bid is online on the 18th. I'll join and take notes for the bid team." },
  { at: 0.93, by: 3, text: "Bid security form requested from the bank; ready two days before submission." },
]

const INCLUSIONS = [
  { description: "Helmet-mount adapter for each headlamp", quantity: 140, unit: "pc", completeness: "COVERED", sourcing: "STOCKABLE_AVAILABLE" },
  { description: "Reflective decal kit, provincial seal", quantity: 65, unit: "set", completeness: "MISSING", sourcing: "SOURCE_OUT", note: "Artwork from the client after award" },
  { description: "Spare rechargeable battery", quantity: 140, unit: "pc", completeness: "SUBSTITUTED", sourcing: "STOCKABLE_NEEDS_ORDERING", note: "18650 in place of the listed 21700" },
]

const TIMELINE_DAYS = 21
const DAY = 86400000

function parseArgs(argv) {
  const args = { apply: false, local: false }
  for (const a of argv) {
    if (a === "--apply") args.apply = true
    else if (a === "--local") args.local = true
    else if (a === "--help" || a === "-h") args.help = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

/** Inserts only the columns the rows carry, so a column left out keeps its default (identity, serial). */
async function insertRows(client, table, rows) {
  if (!rows.length) return 0
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].map((c) => `"${c}"`).join(", ")
  const { rowCount } = await client.query(
    `insert into public.${table} (${columns}) select ${columns} from jsonb_populate_recordset(null::public.${table}, $1::jsonb) on conflict do nothing`,
    [JSON.stringify(rows)],
  )
  return rowCount
}

async function actAs(client, email) {
  const { rows } = await client.query("select id from auth.users where email = $1", [email])
  const claims = { role: "authenticated", email, ...(rows[0] ? { sub: rows[0].id } : {}) }
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
}

/**
 * The demo people, in DEMO_PEOPLE order. On the local stack, whose restored
 * dump may predate the QA accounts, a missing one is stood in for by another
 * local account: nobody is notified on a disposable database.
 */
async function loadPeople(client, { local }) {
  const { rows } = await client.query(
    "select id, email, name from employees where email = any($1) and is_deleted is not true",
    [DEMO_PEOPLE],
  )
  const byEmail = new Map(rows.map((r) => [r.email, r]))
  const missing = DEMO_PEOPLE.filter((e) => !byEmail.has(e))
  if (missing.length && !local) throw new Error(`Demo people missing: ${missing.join(", ")}`)
  if (missing.length) {
    const { rows: spare } = await client.query(
      "select e.id, e.email, e.name from employees e join auth.users u on u.email = e.email where e.is_deleted is not true and e.email <> all($1) order by e.email limit $2",
      [DEMO_PEOPLE, missing.length],
    )
    missing.forEach((email, i) => spare[i] && byEmail.set(email, spare[i]))
  }
  return DEMO_PEOPLE.map((e) => byEmail.get(e))
}

/**
 * Adds to `map` a stand-in for every real employee and Employee Group among
 * `uuids`: employees dealt out over the demo people in id order, groups
 * swapped for a "ZZ Demo — …" group of demo people (created if absent).
 */
async function mapPeople(client, uuids, people, map) {
  const ids = [...uuids]
  const demoIds = new Set(people.map((p) => p.id))
  const { rows: employees } = await client.query("select id from employees where id = any($1::uuid[]) order by id", [ids])
  let i = 0
  for (const { id } of employees) {
    if (map.has(id) || demoIds.has(id)) continue
    map.set(id, people[i++ % people.length].id)
  }

  const { rows: groups } = await client.query("select * from employee_groups where id = any($1::uuid[])", [ids])
  for (const group of groups) {
    const copyId = derivedId(group.id)
    map.set(group.id, copyId)
    await insertRows(client, "employee_groups", [
      { ...group, id: copyId, name: `ZZ Demo — ${group.name}`, created_by: people[0].id, archived_at: null },
    ])
    await insertRows(
      client,
      "employee_group_members",
      people.slice(4, 7).map((p) => ({ id: derivedId(`${group.id}:${p.id}`), group_id: copyId, employee_id: p.id, added_by: people[0].id })),
    )
  }
}

/** Creates (or tops up) the Government copy. Returns the id map Government → copy. */
async function ensureDemoFlow(client, people) {
  const { rows: [source] } = await client.query(
    "select f.* from sales_flows f join sale_types s on s.id = f.sale_type_id where s.name = $1 and s.archived_at is null",
    [SOURCE_SALE_TYPE],
  )
  if (!source) throw new Error(`No ${SOURCE_SALE_TYPE} flow on staging.`)
  const bundle = await readFlowBundle(client, source)

  const map = new Map()
  const own = [bundle.saleType.id, bundle.flow.id]
  for (const { table } of FLOW_TABLES) for (const row of bundle.tables[table]) if (row.id) own.push(row.id)
  for (const id of own) map.set(id, derivedId(id))
  await mapPeople(client, collectUuids(bundle), people, map)

  const saleType = { ...remap(bundle.saleType, map), name: DEMO_SALE_TYPE, created_by: people[0].id }
  const flow = remap(bundle.flow, map)
  let added = await insertRows(client, "sale_types", [saleType])
  added += await insertRows(client, "sales_flows", [{ ...flow, won_stage_id: null }])
  for (const { table } of FLOW_TABLES) added += await insertRows(client, table, remap(bundle.tables[table], map))
  if (flow.won_stage_id) {
    await client.query("update sales_flows set won_stage_id = $2 where id = $1 and won_stage_id is null", [flow.id, flow.won_stage_id])
  }

  const unmapped = [...collectUuids(bundle)].filter((id) => !map.has(id) && !people.some((p) => p.id === id))
  return { map, added, flowId: flow.id, saleTypeId: saleType.id, unmapped }
}

async function rowsOf(client, table, column, ids) {
  const { rows } = await client.query(`select * from public.${table} where ${column} = any($1::uuid[])`, [ids])
  return rows
}

/** Stretches S06048's timeline onto three weeks ending yesterday. */
function makeClock(startMs, endMs) {
  const to = Date.now() - DAY
  const from = to - TIMELINE_DAYS * DAY
  const scale = (to - from) / Math.max(endMs - startMs, 1)
  return (value) => (value == null ? value : new Date(from + (new Date(value).getTime() - startMs) * scale).toISOString())
}

function scrubText(text, reference) {
  if (typeof text !== "string") return text
  return text
    .replaceAll(SOURCE_CLIENT, DEMO.client)
    .replaceAll(SOURCE_REFERENCE, reference)
    .replace(/\s+Bag\b/g, "")
}

async function nextReference(client) {
  const { rows } = await client.query(
    "select max(substring(sales_reference from 4)::int) n from sales_opportunities where sales_reference ~ '^S98[0-9]{3}$'",
  )
  return `S98${String((rows[0].n ?? 0) + 1).padStart(3, "0")}`
}

async function seedSor(client, people, { map: flowMap, flowId }) {
  const [owner, support, director, closer] = people
  const { rows: [src] } = await client.query("select * from sales_opportunities where id = $1", [SOURCE_SOR_ID])
  if (!src) throw new Error(`Source SOR ${SOURCE_REFERENCE} not found on staging.`)

  const { rows: allVisits } = await client.query(
    "select * from sor_stage_visits where opportunity_id = $1 and undone_at is null order by sequence",
    [SOURCE_SOR_ID],
  )
  const srcVisits = allVisits.filter((v) => v.sequence <= PARK_AT_SEQUENCE)
  const visitIds = srcVisits.map((v) => v.id)
  const parkedAt = srcVisits.at(-1).left_at ?? srcVisits.at(-1).entered_at
  const clock = makeClock(new Date(srcVisits[0].entered_at).getTime(), new Date(parkedAt).getTime())

  const groupTasks = await rowsOf(client, "committee_tasks", "stage_visit_id", visitIds)
  const runs = await rowsOf(client, "sor_action_runs", "stage_visit_id", visitIds)
  const fieldValues = await rowsOf(client, "sor_stage_field_values", "stage_visit_id", visitIds)
  const conditionTicks = await rowsOf(client, "sor_condition_status", "stage_visit_id", visitIds)
  const windows = await rowsOf(client, "sor_stage_participants", "opened_visit_id", visitIds)
  const logs = await rowsOf(client, "sales_opportunity_logs", "opportunity_id", [SOURCE_SOR_ID])
  const items = await rowsOf(client, "sales_opportunity_items", "opportunity_id", [SOURCE_SOR_ID])
  const stock = await rowsOf(client, "sor_stock_snapshots", "opportunity_id", [SOURCE_SOR_ID])
  const groupIds = groupTasks.map((t) => t.id)
  const members = await rowsOf(client, "committee_task_members", "committee_task_id", groupIds)
  const activity = await rowsOf(client, "committee_task_activity", "task_id", groupIds)
  const taskLogs = await rowsOf(client, "committee_task_logs", "committee_task_id", groupIds)
  const tags = await rowsOf(client, "committee_task_tags", "committee_task_id", groupIds)

  // One map for the whole SOR: the flow copy, the people, and a fresh id for
  // every row this run creates. Visits are added once the trigger makes them.
  const map = new Map(flowMap)
  const oppId = randomUUID()
  map.set(SOURCE_SOR_ID, oppId)
  for (const row of [...groupTasks, ...runs, ...fieldValues, ...conditionTicks, ...windows, ...logs, ...items, ...members, ...activity, ...taskLogs, ...tags]) {
    if (row.id) map.set(row.id, randomUUID())
  }
  await mapPeople(client, collectUuids([groupTasks, runs, fieldValues, conditionTicks, windows, logs, members, activity, taskLogs, src]), people, map)

  const reference = await nextReference(client)
  const { rows: [snapshot] } = await client.query(
    "select id from flow_snapshots where flow_id = $1 order by version desc, version_minor desc nulls last limit 1",
    [flowId],
  )

  // Registration: the insert trigger opens visit 1 on Lead.
  await actAs(client, owner.email)
  const registeredAt = clock(srcVisits[0].entered_at)
  const { serial_no: _serial, opportunity_no: _no, sor_code: _code, ...srcColumns } = src
  await insertRows(client, "sales_opportunities", [
    {
      ...remap(srcColumns, map),
      id: oppId,
      sales_reference: reference,
      client_name: DEMO.client,
      contact_person: DEMO.contact,
      project_title: DEMO.project,
      project_type: DEMO.projectType,
      lead_source: DEMO.leadSource,
      lead_source_detail: null,
      registration_date: registeredAt.slice(0, 10),
      registered_at: registeredAt,
      registered_by: owner.id,
      created_at: registeredAt,
      updated_at: registeredAt,
      deal_owner_id: owner.id,
      support_sales_1_id: support.id,
      support_sales_2_id: null,
      sales_director_id: director.id,
      closing_sales_id: closer.id,
      is_scratch: true,
      is_deleted: false,
      deleted_at: null,
      deleted_by: null,
      odoo_partner_id: null,
      sale_type_id: map.get(src.sale_type_id),
      flow_stage_id: map.get(srcVisits[0].flow_stage_id),
      flow_snapshot_id: snapshot.id,
      metadata: { releaseDemo: true },
    },
  ])

  const visitOf = async (sequence) => {
    const { rows } = await client.query("select id from sor_stage_visits where opportunity_id = $1 and sequence = $2", [oppId, sequence])
    return rows[0].id
  }
  const forVisit = (rows, column, srcVisitId) => rows.filter((r) => r[column] === srcVisitId)
  const scrub = (row) => {
    const out = remap(row, map)
    for (const key of ["title", "description", "content", "task_description"]) if (key in out) out[key] = scrubText(out[key], reference)
    return out
  }
  const at = (row, ...keys) => {
    const out = { ...row }
    for (const k of keys) if (k in out) out[k] = clock(row[k])
    return out
  }

  // Each visit's Stage Work lands before the move that leaves it, so the
  // leaving trigger puts its open Group Tasks on hold and closes the access
  // windows its rule ends — exactly as a real move would.
  for (const srcVisit of srcVisits) {
    map.set(srcVisit.id, await visitOf(srcVisit.sequence))
    const tasks = forVisit(groupTasks, "stage_visit_id", srcVisit.id)
    const taskIds = new Set(tasks.map((t) => t.id))
    await insertRows(client, "committee_tasks", tasks.map((t) => at(scrub(t), "created_at", "updated_at", "due_date")))
    const seenMembers = new Set()
    await insertRows(
      client,
      "committee_task_members",
      members
        .filter((m) => taskIds.has(m.committee_task_id))
        .map((m) => at(scrub(m), "created_at", "rated_at"))
        .filter((m) => !seenMembers.has(`${m.committee_task_id}:${m.employee_id}`) && seenMembers.add(`${m.committee_task_id}:${m.employee_id}`)),
    )
    await insertRows(client, "committee_task_activity", activity.filter((a) => taskIds.has(a.task_id)).map((a) => at(scrub(a), "created_at")))
    await insertRows(client, "committee_task_logs", taskLogs.filter((l) => taskIds.has(l.committee_task_id)).map((l) => at(scrub(l), "created_at")))
    await insertRows(client, "committee_task_tags", tags.filter((l) => taskIds.has(l.committee_task_id)).map((l) => scrub(l)))
    await insertRows(client, "sor_action_runs", forVisit(runs, "stage_visit_id", srcVisit.id).map((r) => at(scrub(r), "created_at", "decided_at")))
    const seenWindows = new Set()
    await insertRows(
      client,
      "sor_stage_participants",
      forVisit(windows, "opened_visit_id", srcVisit.id)
        .map((w) => ({ ...at(scrub(w), "created_at"), closed_at: null, closed_reason: null }))
        .filter((w) => !seenWindows.has(w.employee_id) && seenWindows.add(w.employee_id)),
    )
    await insertRows(client, "sor_stage_field_values", forVisit(fieldValues, "stage_visit_id", srcVisit.id).map((v) => at(scrub(v), "updated_at")))
    await insertRows(client, "sor_condition_status", forVisit(conditionTicks, "stage_visit_id", srcVisit.id).map((c) => at(scrub(c), "satisfied_at")))

    const next = srcVisits.find((v) => v.sequence === srcVisit.sequence + 1)
    if (next) await client.query("update sales_opportunities set flow_stage_id = $2 where id = $1", [oppId, map.get(next.flow_stage_id)])
  }

  // The moves above all happened "now"; give each visit its place on the timeline.
  for (const srcVisit of srcVisits) {
    const last = srcVisit.sequence === PARK_AT_SEQUENCE
    await client.query(
      "update sor_stage_visits set entered_at = $2, left_at = $3 where id = $1",
      [map.get(srcVisit.id), clock(srcVisit.entered_at), last ? null : clock(srcVisit.left_at)],
    )
    const leftAt = last ? null : clock(srcVisit.left_at)
    if (leftAt) {
      await client.query("update committee_tasks set held_at = $2 where held_from_visit_id = $1", [map.get(srcVisit.id), leftAt])
      await client.query(
        "update sor_stage_participants set closed_at = $2 where opened_visit_id = $1 and closed_at is not null",
        [map.get(srcVisit.id), leftAt],
      )
    }
  }

  // Stage Field answers the source typed as sign-in links; one saved on For
  // Bidding, which the source never answered, so Revert has progress to ask about.
  const { rows: fieldRows } = await client.query(
    `select f.id, f.label, f.stage_id from flow_stage_fields f
       join flow_stages s on s.id = f.stage_id where s.flow_id = $1`,
    [flowId],
  )
  for (const field of fieldRows) {
    if (FIELD_ANSWERS[field.label] == null) continue
    await client.query("update sor_stage_field_values set value = $3 where opportunity_id = $1 and field_id = $2", [
      oppId,
      field.id,
      JSON.stringify(FIELD_ANSWERS[field.label]),
    ])
  }
  const parkedVisit = map.get(srcVisits.at(-1).id)
  const parkedStage = map.get(srcVisits.at(-1).flow_stage_id)
  for (const field of fieldRows.filter((f) => f.stage_id === parkedStage && FIELD_ANSWERS[f.label] != null)) {
    await insertRows(client, "sor_stage_field_values", [
      { id: randomUUID(), opportunity_id: oppId, stage_visit_id: parkedVisit, field_id: field.id, value: FIELD_ANSWERS[field.label], updated_by: owner.id, updated_at: clock(parkedAt) },
    ])
  }

  // The notes column: the source's history minus Flow Snapshot churn and the
  // move to Bid Submitted, its documents swapped for the demo PDFs.
  const lastKept = new Date(parkedAt).getTime()
  const keptLogs = logs
    .filter((l) => new Date(l.created_at).getTime() <= lastKept)
    .filter((l) => !/^Flow Snapshot changed/.test(l.content ?? ""))
    .filter((l) => !l.stage_visit_id || visitIds.includes(l.stage_visit_id))
    .map((l) => {
      const out = at(scrub(l), "created_at")
      if (out.metadata?.attachments) {
        const doc = (l.content ?? "").replace(/^Attached document:\s*/, "")
        out.metadata = {
          ...out.metadata,
          attachments: out.metadata.attachments.map((a) => ({ ...a, url: ATTACHMENT_FOR[doc] ?? DOC("supporting-document"), name: `${doc}.pdf` })),
        }
      }
      return out
    })
  const span = new Date(clock(parkedAt)).getTime() - new Date(registeredAt).getTime()
  const chat = CHAT.map((c) => ({
    id: randomUUID(),
    opportunity_id: oppId,
    author_id: people[c.by].id,
    type: "COMMENT",
    content: c.text,
    metadata: {},
    created_at: new Date(new Date(registeredAt).getTime() + span * c.at).toISOString(),
    stage_visit_id: null,
  }))
  await insertRows(client, "sales_opportunity_logs", [...keptLogs, ...chat])

  // Product List: the source's two helmet lines plus four catalogue lines.
  const { rows: donor } = await client.query(
    `select i.* from sales_opportunity_items i join sales_opportunities o on o.id = i.opportunity_id
      where o.sales_reference = $1 and o.is_deleted is not true and i.odoo_product_id is not null
      order by i.sort_order limit 4`,
    [ITEM_DONOR_ID_REFERENCE],
  )
  const lineItems = [...items, ...donor].map((it, i) => ({
    ...at(it, "created_at", "updated_at"),
    id: randomUUID(),
    opportunity_id: oppId,
    sort_order: i,
  }))
  await insertRows(client, "sales_opportunity_items", lineItems)
  const total = lineItems.reduce((s, it) => s + Number(it.quantity) * Number(it.unit_price), 0)
  await client.query("update sales_opportunities set expected_value = $2 where id = $1", [oppId, total])
  await insertRows(client, "sor_stock_snapshots", stock.map((s) => ({ ...at(s, "fetched_at"), opportunity_id: oppId, fetched_by: owner.id })))

  await insertRows(
    client,
    "sor_inclusions",
    INCLUSIONS.map((inc, i) => ({ id: randomUUID(), opportunity_id: oppId, sort_order: i, created_by: support.id, created_at: registeredAt, updated_at: registeredAt, note: null, ...inc })),
  )
  await insertRows(
    client,
    "sales_opportunity_members",
    [people[4], people[6]].map((p) => ({ id: randomUUID(), opportunity_id: oppId, employee_id: p.id, added_by: owner.id, added_at: registeredAt })),
  )

  // Two individual tasks on the current Stage: one open, one already done —
  // the done one is also progress Revert asks about.
  const due = (days) => new Date(Date.now() + days * DAY).toISOString()
  await insertRows(client, "tasks", [
    individualTask({ oppId, visit: parkedVisit, who: closer.id, title: `Bid security — ${reference}`, text: "Get the bid securing declaration signed and scanned for the envelope.", status: "INCOMPLETE", start: clock(parkedAt), end: due(2), priority: "HIGH" }),
    individualTask({ oppId, visit: parkedVisit, who: support.id, title: `Eligibility documents — ${reference}`, text: "PhilGEPS certificate, mayor's permit and tax clearance, certified true copies.", status: "COMPLETE", start: clock(parkedAt), end: due(-1), priority: "MEDIUM" }),
  ])

  // What the room will see, read back through the app's own functions.
  const { rows: [check] } = await client.query(
    `select
       (select count(*) from committee_tasks where opportunity_id = $1 and status = 'ON_HOLD')::int held,
       (select count(*) from committee_tasks where opportunity_id = $1 and status = 'ACTIVE')::int active,
       (select count(*) from sor_stage_participants where opportunity_id = $1 and closed_at is null)::int open_windows,
       public.sor_revert_needs_progress_choice($1) asks_keep_or_remove`,
    [oppId],
  )
  return { oppId, reference, total, visits: srcVisits.length, groupTasks: groupTasks.length, logs: keptLogs.length + chat.length, check }
}

function individualTask({ oppId, visit, who, title, text, status, start, end, priority }) {
  return {
    id: randomUUID(),
    created_at: start,
    category_id: "DOCUMENTS CREATED / FOR SUBMISSION / APPROVAL",
    logged_by: who,
    reported_to: null,
    task_description: text,
    project_title: title,
    priority,
    status,
    remarks: "",
    grade: 0,
    start_at: start,
    end_at: end,
    hr_verified: false,
    hr_remarks: "",
    attachment_urls: [],
    checklist: null,
    opportunity_id: oppId,
    stage_action_id: null,
    stage_visit_id: visit,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("Usage: node scripts/seed-release-demo.mjs [--local] [--apply]")
    return
  }
  const url = args.local ? DEFAULT_LOCAL_DB_URL : loadDotEnvLocal(repoRoot).STAGING_DB_URL ?? process.env.STAGING_DB_URL
  if (!url) throw new Error("STAGING_DB_URL is not set (.env.local or the environment).")

  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query("begin")
    const people = await loadPeople(client, args)
    const flow = await ensureDemoFlow(client, people)
    const sor = await seedSor(client, people, flow)
    await client.query(args.apply ? "commit" : "rollback")

    console.log(`${args.apply ? "✔ Applied" : "✔ Rehearsal OK (rolled back)"}`)
    console.log(`  ${DEMO_SALE_TYPE}: ${flow.added} rows added`)
    console.log(`  ${sor.reference} (${sor.oppId}): ${sor.visits} visits, ${sor.groupTasks} Group Tasks, ${sor.logs} notes, ₱${sor.total.toLocaleString("en-PH")}`)
    console.log(`  ${sor.check.active} Group Task(s) live on For Bidding, ${sor.check.held} on hold, ${sor.check.open_windows} access window(s) open; Revert asks Keep/Remove: ${sor.check.asks_keep_or_remove}`)
    if (flow.unmapped.length) console.log(`  uuids in Government left as they are (task templates, rows its old snapshots name): ${flow.unmapped.length}`)
  } catch (err) {
    await client.query("rollback").catch(() => {})
    console.error(`✖ ${err.message}\n  Nothing was written.`)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
