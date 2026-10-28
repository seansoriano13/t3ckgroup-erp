#!/usr/bin/env node
/**
 * Fills STAGING's Purchasing Dashboard with realistic work, built on S0 numbers that
 * already exist in Odoo and on the SORs staging already holds for them.
 *
 *   - Staging only. It refuses any other database.
 *   - Odoo is only read, through the staging app's own `odoo-po-suggest` and
 *     `odoo-po-ipas` functions, signed in as the demo Purchaser (cjay@demo). The P0 numbers,
 *     suppliers, order dates, quantities, received counts and prices on the lines are
 *     Odoo's. Nothing is typed in by hand and nothing is written to Odoo.
 *   - Each chosen SOR gets one Purchase Request listing its own S0 lines. A line that a real
 *     P0 bought is Purchased or Received, the rest are spread over Not checked, To purchase,
 *     Still canvassing (with Offers) and Available. Real P0s that are still RFQs keep the
 *     line at To purchase, like the app does.
 *   - IPAS are raised for some of the real P0s through the app's own "raise" path, so each
 *     one holds Odoo's own copy of the PO. A few get a payment.
 *   - It never touches the demo's own deals (S03885, S04081, S04602), their POs, any SOR
 *     that already has a Purchase Request, any PO that already has an IPAS, or any SOR on the
 *     "Project [FOR DEMO]" sale type, so `scripts/demo-purchasing-setup.mjs --apply` leaves
 *     everything here alone. See docs/demos/purchasing-demo-run-sheet.html.
 *
 * Without --apply the database part rolls back, so the default run is a rehearsal.
 * What an --apply run made is written to scripts/seed-purchasing-dashboard.manifest.json
 * (ignored by git), and --remove undoes exactly that.
 *
 *   node scripts/seed-purchasing-dashboard.mjs            # dry run
 *   node scripts/seed-purchasing-dashboard.mjs --apply
 *   node scripts/seed-purchasing-dashboard.mjs --remove   # dry run of the removal
 *   node scripts/seed-purchasing-dashboard.mjs --remove --apply
 */
import pg from "pg"
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const MANIFEST = join(dirname(fileURLToPath(import.meta.url)), "seed-purchasing-dashboard.manifest.json")

const STAGING_REF = "fpjxdyowngpnovotbzqi"
const STAGING_API = `https://${STAGING_REF}.supabase.co`
// The publishable key is public by design (it ships in the website).
const PUBLISHABLE_KEY = "sb_publishable_Q4l8GvnBSTmDvMs9YSvOpw_A4cwNsug"
const ACTOR = { email: "cjay@demo", password: "demo" }

// What the demo run sheet uses. None of it is touched here.
const DEMO_SORS = ["S03885", "S04081", "S04602"]
const DEMO_POS = ["P01235", "P01317", "P02674", "P02587", "P02181", "P02679"]
const DEMO_SALE_TYPE = "Project [FOR DEMO]"

const OTHER_SORS = 30 // SORs with no real P0, seeded for the earlier groups
const MAX_IPAS = 10
const DAY = 86_400_000

// ---------- small helpers ----------

function rngFrom(text) {
  let h = 2166136261
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = rngFrom("purchasing-dashboard-seed-v1")
const between = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
const pick = (r, list) => list[Math.floor(r() * list.length)]
const weighted = (r, entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0)
  let x = r() * total
  for (const [value, w] of entries) if ((x -= w) < 0) return value
  return entries[entries.length - 1][0]
}
const daysAgo = (n) => new Date(Date.now() - n * DAY)
const iso = (d) => d.toISOString()
const day = (d) => iso(d).slice(0, 10)

const norm = (s) => String(s ?? "").toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^a-z0-9]+/g, " ").trim()
const tokens = (s) => new Set(norm(s).split(" ").filter((t) => t.length > 2))
function similarity(a, b) {
  const A = tokens(a), B = tokens(b)
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const t of A) if (B.has(t)) hit++
  // Both must hold, so a short name does not match everything that contains it.
  return hit / Math.min(A.size, B.size) >= 0.75 && hit / Math.max(A.size, B.size) >= 0.4 ? hit / Math.max(A.size, B.size) : 0
}

async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } })
  await client.connect()
  return client
}

// ---------- the staging app (Odoo reads, IPAS raise) ----------

async function signIn() {
  const res = await fetch(`${STAGING_API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(ACTOR),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`Could not sign in as ${ACTOR.email}. Run scripts/demo-purchasing-setup.mjs --apply first.`)
  return json.access_token
}

const call = (token, path, body) =>
  fetch(`${STAGING_API}${path}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))

async function odooP0s(token, ref) {
  const { json } = await call(token, "/functions/v1/odoo-po-suggest", { reference: ref, productId: null })
  if (!json?.success) return null
  return [...(json.suggested ?? []), ...(json.others ?? [])]
}

// ---------- choosing the SORs ----------

const looksReal = (s) => (s.client_name ?? "").trim().length >= 5 && !/\b(test|asd|sample|dummy)\b|^\W*\w{1,3}\W*$/i.test(s.project_title ?? "") && !/shopee|^retail/i.test(`${s.client_name} ${s.project_title}`)

async function loadCandidates(c) {
  const { rows } = await c.query(
    `select o.id, o.sales_reference ref, o.client_name, o.project_title, o.created_at, o.registered_by, o.deal_owner_id,
            (select json_agg(json_build_object('id', i.id, 'name', i.product_name, 'qty', i.quantity, 'unit', i.unit, 'pid', i.odoo_product_id, 'price', i.unit_price) order by i.sort_order, i.created_at)
               from sales_opportunity_items i where i.opportunity_id = o.id and not coalesce(i.removed_from_s0, false)) items
       from sales_opportunities o
       left join sale_types t on t.id = o.sale_type_id
      where not o.is_deleted and not o.is_scratch
        and o.sales_reference ~ '^S0[0-9]{4,}$' and o.sales_reference <> all($1::text[])
        and coalesce(t.name, '') not like $2
        and not exists (select 1 from purchase_requests r where r.opportunity_id = o.id)
        and exists (select 1 from sales_opportunity_items i where i.opportunity_id = o.id and not coalesce(i.removed_from_s0, false))
      order by o.created_at desc`,
    [DEMO_SORS, `${DEMO_SALE_TYPE}%`],
  )
  // One SOR per S0 number: staging has a few duplicates. Keep the one with the most lines.
  const byRef = new Map()
  for (const row of rows) {
    const keep = byRef.get(row.ref)
    if (!keep || row.items.length > keep.items.length) byRef.set(row.ref, row)
  }
  return [...byRef.values()].filter(looksReal)
}

// ---------- the plan ----------

/** Matches each SOR line to at most one real P0 line, best matches first. */
function matchLines(items, pos) {
  const pairs = []
  items.forEach((item, i) => {
    for (const po of pos) {
      for (const line of po.lines) {
        const score = item.pid && line.product_id === item.pid ? 2 : similarity(item.name, line.product_name)
        if (score >= 0.4) pairs.push({ i, po, line, score })
      }
    }
  })
  pairs.sort((a, b) => b.score - a.score)
  const usedItem = new Set(), usedLine = new Set(), out = new Map()
  for (const p of pairs) {
    if (usedItem.has(p.i) || usedLine.has(p.line.id)) continue
    usedItem.add(p.i)
    usedLine.add(p.line.id)
    out.set(p.i, p)
  }
  return out
}

const SUPPLIER_FALLBACK = ["Lazada Business Supplies", "Metro Industrial Trading", "Shenzhen Coming Technology Co., Ltd.", "Pioneer Safety Equipment Corp.", "Globe Rescue Supply", "Dragon Peak Outdoors Inc."]

function planSor(sor, pos, ctx) {
  const r = rngFrom(sor.ref)
  const usable = pos.filter((p) => !DEMO_POS.includes(p.name) && !ctx.ipasPos.has(p.name) && !DEMO_SORS.some((s) => String(p.source ?? "").includes(s)))
  const matches = matchLines(sor.items, usable)
  const persona = usable.length
    ? "bought"
    : weighted(r, [["fresh", 15], ["working", 40], ["sourcing", 25], ["stock", 20]])
  const mix = {
    bought: [["to_purchase", 40], ["still_canvassing", 20], ["available", 20], ["not_checked", 20]],
    fresh: [["not_checked", 100]],
    working: [["to_purchase", 45], ["available", 20], ["still_canvassing", 20], ["not_checked", 15]],
    sourcing: [["still_canvassing", 60], ["to_purchase", 30], ["not_checked", 10]],
    stock: [["available", 60], ["to_purchase", 30], ["cancelled", 10]],
  }[persona]

  const createdAt = daysAgo(between(r, 4, 55))
  let canvassLeft = 4
  const lines = sor.items.map((item, i) => {
    const m = matches.get(i)
    if (m) {
      const ordered = m.line.quantity
      const received = m.line.received
      const live = ["purchase", "done"].includes(m.po.state)
      const status = !live ? "to_purchase" : ordered > 0 && received >= ordered ? "received" : "purchased"
      return {
        item,
        status,
        po: { number: m.po.name, state: live ? "confirmed" : "rfq", ordered, received: live ? received : 0, eta: (m.po.ordered_on ?? "").slice(0, 10) || null, lineId: m.line.id, boughtAs: m.line.product_name, supplier: m.po.supplier, orderedOn: m.po.ordered_on, price: m.line.price_unit },
      }
    }
    let status = weighted(r, mix)
    if (status === "still_canvassing" && canvassLeft-- <= 0) status = "to_purchase"
    return { item, status, po: null }
  })
  return { sor, persona, createdAt, lines, pos: usable }
}

// ---------- writing ----------

async function writePlan(c, plan, staff, ctx) {
  const r = rngFrom(plan.sor.ref + "|write")
  const buyer = r() < 0.2 ? null : weighted(r, staff.purchasing.map((e, i) => [e, i === 0 ? 3 : 2]))
  const requester = plan.sor.registered_by ?? plan.sor.deal_owner_id ?? pick(r, staff.sales)
  const firstP0 = plan.lines.filter((l) => l.po?.orderedOn).map((l) => new Date(l.po.orderedOn.replace(" ", "T") + "Z").getTime())
  // The request opens before its first real P0 was ordered.
  const opened = firstP0.length ? new Date(Math.min(...firstP0) - between(r, 1, 6) * DAY) : plan.createdAt

  const { rows: [pr] } = await c.query(
    `insert into purchase_requests (opportunity_id, buyer_id, created_by, access_until, requesters, created_at, updated_at)
     values ($1, $2, $3, 'terminal', '[]'::jsonb, $4, $4) returning id, pr_number`,
    [plan.sor.id, buyer, requester, iso(opened)],
  )
  await c.query("insert into purchase_request_members (request_id, employee_id, side, added_by, added_at) values ($1, $2, 'requester', $2, $3)", [pr.id, requester, iso(opened)])
  if (buyer) await c.query("insert into purchase_request_members (request_id, employee_id, side, added_by, added_at) values ($1, $2, 'purchasing', $2, $3)", [pr.id, buyer, iso(opened)])
  // The insert trigger listed every S0 line as a Not checked item.
  await c.query("update purchase_request_items set created_at = $2 where request_id = $1", [pr.id, iso(opened)])

  const { rows: items } = await c.query("select id, sor_item_id from purchase_request_items where request_id = $1", [pr.id])
  const itemFor = new Map(items.map((i) => [i.sor_item_id, i.id]))
  const actor = buyer ?? staff.purchasing[0]
  const made = { request: pr.id, number: pr.pr_number, items: items.length, canvasses: 0 }
  const events = []

  for (const line of plan.lines) {
    const itemId = itemFor.get(line.item.id)
    if (!itemId) continue
    const changedAt = line.po?.orderedOn
      ? new Date(line.po.orderedOn.replace(" ", "T") + "Z")
      : line.status === "not_checked"
        ? null
        : new Date(opened.getTime() + between(r, 1, Math.max(2, Math.floor((Date.now() - opened.getTime()) / DAY))) * DAY)
    const canvass = line.status === "still_canvassing"
    const writeStatus = canvass ? "to_purchase" : line.status
    await c.query(
      `update purchase_request_items set status = $2, po_number = $3, po_verification = $4, po_state = $5, po_ordered = $6, po_received = $7,
              po_eta = $8, odoo_po_line_ids = $9::int[], bought_as = $10, po_synced_at = $11, status_changed_by = $12, status_changed_at = $13,
              closed_note = $14
        where id = $1`,
      [
        itemId, writeStatus,
        line.po?.number ?? null, line.po ? "VERIFIED" : "UNVERIFIED", line.po?.state ?? null, line.po?.ordered ?? null, line.po?.received ?? null,
        line.po?.eta ?? null, line.po ? [line.po.lineId] : [], line.po?.boughtAs ?? null, line.po ? iso(new Date()) : null,
        changedAt ? actor : null, changedAt ? iso(changedAt) : null,
        line.status === "cancelled" ? pick(r, ["Client dropped this line from the tender", "Covered by another line"]) : null,
      ],
    )
    if (canvass) {
      const when = changedAt ?? new Date(opened.getTime() + DAY)
      const { rows: [cv] } = await c.query(
        // No request_made_at: that stamp locks the Canvass, and these are still open.
        `insert into sor_canvasses (requested_item_id, product_name, created_by, canvasser_id, created_at, updated_at)
         values ($1, $2, $3, $3, $4, $4) returning id`,
        [itemId, line.item.name, actor, iso(when)],
      )
      const base = Number(line.item.price) > 0 ? Number(line.item.price) * (0.55 + r() * 0.25) : between(r, 800, 24000)
      const suppliers = [...new Set([...ctx.suppliers].sort(() => r() - 0.5).slice(0, between(r, 2, 4)))]
      for (const [k, name] of suppliers.entries()) {
        const usd = /shenzhen|guangzhou|ningbo|china|co\.?, ?ltd|limited/i.test(name)
        const peso = Math.round(base * (0.9 + r() * 0.25) * 100) / 100
        const { rows: [offer] } = await c.query(
          `insert into sor_canvass_offers (canvass_id, supplier_name, currency, lead_time, valid_until, sort_order, is_winner, created_by, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, false, $7, $8, $8) returning id`,
          [cv.id, name, usd ? "USD" : "PHP", pick(r, ["3 days", "1 week", "2 weeks", "3 to 4 weeks"]), day(new Date(when.getTime() + 30 * DAY)), k, actor, iso(when)],
        )
        // The price sits in its own table, which only Purchasing and the money readers can see.
        await c.query("insert into sor_canvass_offer_prices (offer_id, unit_price, comparison_rate, updated_at) values ($1, $2, $3, $4)", [offer.id, usd ? Math.round((peso / 63.5) * 100) / 100 : peso, usd ? 63.5 : null, iso(when)])
      }
      // The trigger flipped the line to Still canvassing at "now"; the record and its chat note belong to `when`.
      await c.query("update purchase_request_items set status_changed_at = $2, status_changed_by = $3 where id = $1", [itemId, iso(when), actor])
      await c.query("update purchase_request_messages set created_at = $3 where request_id = $1 and created_at = now() and metadata->>'item_id' = $2", [pr.id, itemId, iso(when)])
      made.canvasses++
    }
  }

  // A short, believable conversation, dated after the request opened.
  const bought = plan.lines.find((l) => l.po)
  const talk = [[requester, `Hi Purchasing, please check the lines for ${plan.sor.client_name}.`, 0]]
  if (buyer) talk.push([buyer, pick(r, ["Taking this. Checking stock first.", "Got it. I will price what we do not have.", "Noted. Starting with the long lead items."]), 1])
  if (bought && buyer) talk.push([buyer, `${bought.po.number} is with ${bought.po.supplier ?? "the supplier"}${bought.po.eta ? `, ordered ${bought.po.eta}` : ""}.`, 3])
  else if (plan.lines.some((l) => l.status === "still_canvassing") && buyer) talk.push([buyer, "Canvassing the rest now. Offers are on each line.", 2])
  for (const [author, content, offset] of talk) {
    await c.query("insert into purchase_request_messages (request_id, author_id, content, created_at) values ($1, $2, $3, $4)", [pr.id, author, content, iso(new Date(Math.min(Date.now() - 3600_000, opened.getTime() + offset * DAY + 3600_000)))])
  }
  return made
}

// ---------- IPAS ----------

async function raiseIpas(token, plans, c, apply) {
  const candidates = new Map()
  for (const plan of plans) {
    for (const line of plan.lines) {
      if (!line.po || line.po.state !== "confirmed") continue
      const entry = candidates.get(line.po.number) ?? { number: line.po.number, supplier: line.po.supplier, status: new Set(), lines: 0, sors: new Set(), origin: null }
      entry.status.add(line.status)
      entry.lines++
      entry.sors.add(plan.sor.id)
      candidates.set(line.po.number, entry)
    }
  }
  const all = [...candidates.values()].sort((a, b) => b.lines - a.lines)
  const chosen = [...all.filter((e) => e.status.has("purchased")).slice(0, 6), ...all.filter((e) => !e.status.has("purchased")).slice(0, 4)].slice(0, MAX_IPAS)
  if (!apply) {
    for (const e of chosen) console.log(`  would raise an IPAS for ${e.number} (${e.supplier ?? "supplier unknown"}, ${e.lines} line${e.lines === 1 ? "" : "s"})`)
    return []
  }
  const { rows: methods } = await c.query("select id, label from ipas_options where list = 'payment_method' order by label")
  const bank = methods.find((m) => /bank/i.test(m.label)) ?? methods[0]
  const raised = []
  for (const [n, e] of chosen.entries()) {
    const r = rngFrom(e.number)
    const res = await call(token, "/functions/v1/odoo-po-ipas", {
      action: "raise", poNumber: e.number,
      priority: weighted(r, [["medium", 5], ["high", 3], ["very_high", 1]]),
      source: /shenzhen|guangzhou|ningbo|china|ltd|limited|co\.,/i.test(e.supplier ?? "") ? "import" : "local",
      purpose: "project", sorIds: [...e.sors], remarks: null,
    })
    const row = res.json?.ipas ?? res.json?.data ?? res.json
    if (!res.json?.success && !row?.id) { console.log(`  skipped ${e.number}: ${res.json?.message ?? res.status}`); continue }
    const id = row.id ?? res.json?.id
    const total = Number(row.odoo_copy?.po?.amount_total ?? 0)
    // Half of them have been paid, some in full, some a down payment.
    if (id && bank && total > 0 && n % 2 === 0) {
      const full = r() < 0.5
      const amount = Math.round(total * (full ? 1 : 0.3 + r() * 0.2) * 100) / 100
      const foreign = row.odoo_copy?.po?.currency && row.odoo_copy.po.currency !== "PHP"
      const pay = await call(token, "/rest/v1/rpc/ipas_add_payment", {
        p_ipas_id: id, p_kind: full ? "full_payment" : "down_payment", p_paid_on: day(daysAgo(between(r, 3, 30))), p_amount: amount,
        p_php_debited: foreign ? Math.round(amount * 58 * 100) / 100 : null, p_charge_fee_php: null, p_method_id: bank.id, p_check_no: null, p_proof_url: null,
      })
      if (pay.status >= 300) console.log(`  payment on ${e.number} refused: ${JSON.stringify(pay.json)?.slice(0, 160)}`)
    }
    raised.push({ id, number: row.number ?? null, po: e.number })
    console.log(`  IPAS ${row.number ?? "?"} for ${e.number} (${e.lines} line${e.lines === 1 ? "" : "s"})`)
  }
  return raised
}

// ---------- main ----------

async function seed({ apply }) {
  if (existsSync(MANIFEST)) throw new Error("A seed from an earlier run is on record. Run with --remove --apply first.")
  const env = loadDotEnvLocal(repoRoot)
  const stagingUrl = env.STAGING_DB_URL ?? process.env.STAGING_DB_URL
  if (!stagingUrl || !stagingUrl.includes(STAGING_REF)) throw new Error("STAGING_DB_URL must point at the staging database.")
  if ((env.PROD_DB_URL ?? process.env.PROD_DB_URL) === stagingUrl) throw new Error("STAGING_DB_URL is the production database.")

  const c = await connect(stagingUrl)
  console.log(apply ? "APPLYING to STAGING" : "DRY RUN on STAGING (rolls back; pass --apply to commit)")
  try {
    const token = await signIn()
    const candidates = await loadCandidates(c)
    console.log(`1. ${candidates.length} SORs with an S0 number and lines, none with a request yet. Asking Odoo about each...`)

    const { rows: ipasRows } = await c.query("select po_number from ipas where state <> 'cancelled'")
    const ctx = { ipasPos: new Set(ipasRows.map((r) => r.po_number)), suppliers: new Set() }

    const withPos = [], without = []
    let failed = 0
    for (const sor of candidates) {
      const pos = await odooP0s(token, sor.ref)
      if (pos === null) { failed++; continue }
      for (const p of pos) if (p.supplier) ctx.suppliers.add(p.supplier)
      ;(pos.length ? withPos : without).push({ sor, pos })
    }
    if (failed > candidates.length * 0.2) throw new Error(`Odoo did not answer for ${failed} of ${candidates.length} SORs. Nothing written.`)
    SUPPLIER_FALLBACK.forEach((s) => ctx.suppliers.add(s))

    const planned = withPos.map(({ sor, pos }) => planSor(sor, pos, ctx)).filter((p) => p.persona === "bought" && p.lines.some((l) => l.po))
    const boughtIds = new Set(planned.map((p) => p.sor.id))
    // The rest: SORs with no real P0 yet (or only ones this script skips), chosen at random but the same each run.
    const pool = [...withPos.filter(({ sor }) => !boughtIds.has(sor.id)), ...without]
      .filter(({ sor }) => sor.items.length <= 40)
      .sort(() => rng() - 0.5)
      .slice(0, OTHER_SORS)
    for (const { sor } of pool) planned.push(planSor(sor, [], ctx))
    console.log(`2. Plan: ${planned.length} requests, ${planned.filter((p) => p.persona === "bought").length} of them built on real P0s.`)

    const { rows: purchasing } = await c.query(
      `select id from employees where not coalesce(is_deleted,false) and has_purchasing_flow and sub_department = 'PURCHASING' and email not like '%mock%' order by (email = 'cjay@demo') desc, name`)
    const { rows: sales } = await c.query("select id from employees where not coalesce(is_deleted,false) and has_sales_flow and not has_purchasing_flow and email not like '%mock%' limit 12")
    if (!purchasing.length || !sales.length) throw new Error("No Purchasing or Sales staff found.")
    const staff = { purchasing: purchasing.map((e) => e.id), sales: sales.map((e) => e.id) }

    await c.query("begin")
    const requests = []
    for (const plan of planned) requests.push(await writePlan(c, plan, staff, ctx))
    const tally = {}
    for (const plan of planned) for (const l of plan.lines) tally[l.status] = (tally[l.status] ?? 0) + 1
    console.log("3. Requested lines by status:", tally, `· canvasses: ${requests.reduce((s, q) => s + q.canvasses, 0)}`)
    await c.query(apply ? "commit" : "rollback")

    console.log(`4. IPAS (${apply ? "raised through the app, with Odoo's own copy of each PO" : "preview"}):`)
    const ipas = await raiseIpas(token, planned, c, apply)
    if (apply) {
      writeFileSync(MANIFEST, JSON.stringify({ madeAt: new Date().toISOString(), requests: requests.map((q) => q.request), ipas }, null, 2))
      console.log(`\nCommitted. ${requests.length} requests, ${ipas.length} IPAS. Undo with: node scripts/seed-purchasing-dashboard.mjs --remove --apply`)
    } else {
      console.log("\nRolled back (dry run). Nothing was written.")
    }
  } catch (e) {
    await c.query("rollback").catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

async function remove({ apply }) {
  if (!existsSync(MANIFEST)) throw new Error("No seed on record (scripts/seed-purchasing-dashboard.manifest.json is missing).")
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"))
  const env = loadDotEnvLocal(repoRoot)
  const stagingUrl = env.STAGING_DB_URL ?? process.env.STAGING_DB_URL
  if (!stagingUrl || !stagingUrl.includes(STAGING_REF)) throw new Error("STAGING_DB_URL must point at the staging database.")
  const c = await connect(stagingUrl)
  console.log(apply ? "REMOVING from STAGING" : "DRY RUN of the removal on STAGING (rolls back; pass --apply to commit)")
  try {
    const token = await signIn()
    await c.query("begin")
    const ids = manifest.requests
    const items = "(select id from purchase_request_items where request_id = any($1::uuid[]))"
    await c.query(`delete from sor_canvass_offer_prices where offer_id in (select o.id from sor_canvass_offers o join sor_canvasses v on v.id = o.canvass_id where v.requested_item_id in ${items})`, [ids])
    await c.query(`delete from sor_canvass_offers where canvass_id in (select id from sor_canvasses where requested_item_id in ${items})`, [ids])
    await c.query(`delete from sor_canvasses where requested_item_id in ${items}`, [ids])
    await c.query(`delete from purchase_request_item_prices where item_id in ${items}`, [ids])
    await c.query("delete from purchase_request_messages where request_id = any($1::uuid[])", [ids])
    await c.query("delete from purchase_request_items where request_id = any($1::uuid[])", [ids])
    await c.query("delete from purchase_request_members where request_id = any($1::uuid[])", [ids])
    const gone = await c.query("delete from purchase_requests where id = any($1::uuid[])", [ids])
    console.log(`  ${gone.rowCount} requests removed with their lines, canvasses, offers, chat and members`)
    await c.query(apply ? "commit" : "rollback")
    if (apply) {
      for (const ipas of manifest.ipas) {
        const res = await call(token, "/rest/v1/rpc/ipas_cancel", { p_ipas_id: ipas.id, p_reason: "Demo data removed" })
        console.log(`  cancelled IPAS ${ipas.number ?? ipas.id} (${ipas.po}): ${res.status < 300 ? "ok" : JSON.stringify(res.json)?.slice(0, 120)}`)
      }
      unlinkSync(MANIFEST)
      console.log("\nRemoved. IPAS stay on the list as Cancelled (an IPAS number is never reused).")
    } else {
      console.log("\nRolled back (dry run). IPAS are only cancelled with --apply.")
    }
  } catch (e) {
    await c.query("rollback").catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

const flags = { apply: process.argv.includes("--apply") }
;(process.argv.includes("--remove") ? remove(flags) : seed(flags)).catch((e) => {
  console.error(`\n✖ ${e.message}\n  Nothing more was written.`)
  process.exit(1)
})
