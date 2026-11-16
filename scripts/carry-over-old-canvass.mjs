/**
 * Carries old per-line Canvasses into the per-request Canvass tables, adding rows only.
 *
 * Migration 967 drops the old tables (sor_canvasses, sor_canvass_offers, ...). Their rows are saved
 * to a JSON file first, read-only, and this script puts them back in the new shape after the
 * migration: one request_canvasses row per Purchase Request, a supplier per Offer, a quote and a
 * unit price per Offer on its Requested Item. Release 2026-11 mid used it for the one old Canvass on
 * prod (docs/release-2026-11-mid-prod-plan.md).
 *
 * Usage:
 *   node scripts/carry-over-old-canvass.mjs <prod|staging> <saved.json>           dry run: adds, prints, rolls back
 *   node scripts/carry-over-old-canvass.mjs <prod|staging> <saved.json> --apply   adds and commits
 *
 * <saved.json>: { sor_canvasses, sor_canvass_offers, sor_canvass_offer_prices,
 *   sor_canvass_no_other_supplier, sor_canvass_signoff_events, requested_items }, each a list of rows.
 *
 * It never deletes or overwrites. A Purchase Request that already has a Canvass is skipped. The old
 * CNV_ number is kept when no Canvass has it yet. It stops, changing nothing, on anything it cannot
 * carry as it was: a Canvass on a Component or with no subject, a stopped or signed-off Canvass, a
 * picked winner, or a "No other supplier" note. Those are re-entered in the grid by hand.
 *
 * Reads PROD_DB_URL / STAGING_DB_URL from .env.local or the environment. Never prints them.
 */
import pg from "pg"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const [target, file] = process.argv.slice(2)
const apply = process.argv.includes("--apply")
if (!["prod", "staging"].includes(target) || !file) {
  console.error("Usage: node scripts/carry-over-old-canvass.mjs <prod|staging> <saved.json> [--apply]")
  process.exit(1)
}

const envVar = target === "prod" ? "PROD_DB_URL" : "STAGING_DB_URL"
const projectRef = target === "prod" ? "epqmberwewztzbrkhhss" : "fpjxdyowngpnovotbzqi"
const dbUrl = loadDotEnvLocal(repoRoot)[envVar] ?? process.env[envVar]
if (!dbUrl) {
  console.error(`Missing ${envVar}. Set it in .env.local or the environment.`)
  process.exit(1)
}
if (!dbUrl.includes(projectRef)) {
  console.error(`${envVar} does not name the ${target} project (${projectRef}). Stopping.`)
  process.exit(1)
}

const saved = JSON.parse(readFileSync(file, "utf8"))
const list = (name) => saved[name] ?? []

// Refuse, before connecting, anything this script cannot carry as it was.
const problems = []
for (const c of list("sor_canvasses")) {
  if (!c.requested_item_id) problems.push(`${c.number} is not on a Requested Item`)
  if (c.stopped_at) problems.push(`${c.number} was stopped`)
  if (c.signed_off_at) problems.push(`${c.number} was signed off`)
}
for (const o of list("sor_canvass_offers")) {
  if (o.is_winner) problems.push(`an Offer on Canvass ${o.canvass_id} was picked as the winner`)
}
if (list("sor_canvass_no_other_supplier").length) problems.push('a "No other supplier" note is saved')
if (list("sor_canvass_signoff_events").length) problems.push("sign-off events are saved")
if (problems.length) {
  console.error("Not carried over, nothing changed:\n  - " + problems.join("\n  - "))
  process.exit(1)
}

const priceOf = new Map(list("sor_canvass_offer_prices").map((p) => [p.offer_id, p]))
const SEQ = "public.sor_canvass_number_seq"

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
await client.connect()
const one = async (sql, params) => (await client.query(sql, params)).rows[0]

// The CNV_ sequence is not rolled back with the transaction, so its state is put back by hand.
const seqBefore = await one(`select last_value, is_called from ${SEQ}`)
const used = (s) => (s.is_called ? Number(s.last_value) : Number(s.last_value) - 1)
let highestNumberUsed = used(seqBefore)

const report = []
try {
  await client.query("begin")

  for (const c of list("sor_canvasses")) {
    const item = await one(
      "select id, request_id, status from public.purchase_request_items where id = $1",
      [c.requested_item_id],
    )
    if (!item) throw new Error(`${c.number}: its Requested Item is no longer there`)

    const existing = await one("select number from public.request_canvasses where request_id = $1", [item.request_id])
    if (existing) {
      report.push(`${c.number}: skipped, its Purchase Request already has Canvass ${existing.number}`)
      continue
    }

    // Keep the old number when it is free: point the sequence at it for this one insert.
    const wanted = Number(String(c.number).replace(/^CNV_0*/, ""))
    const taken = await one("select 1 as x from public.request_canvasses where number = $1", [c.number])
    if (Number.isInteger(wanted) && wanted > 0 && !taken) {
      await client.query(`select setval('${SEQ}', $1, false)`, [wanted])
    }

    const canvass = await one(
      `insert into public.request_canvasses (request_id, number, canvasser_id, attachments, created_by, created_at, updated_at)
       values ($1, 'pending', $2, $3, $4, $5, $6) returning id, number`,
      [item.request_id, c.canvasser_id, JSON.stringify(c.attachments ?? []), c.created_by, c.created_at, c.updated_at],
    )
    highestNumberUsed = Math.max(highestNumberUsed, Number(canvass.number.replace(/^CNV_0*/, "")))
    // Put the sequence back past every number in use, so the next Canvass never repeats one.
    await client.query(`select setval('${SEQ}', $1, true)`, [highestNumberUsed])

    const offers = list("sor_canvass_offers")
      .filter((o) => o.canvass_id === c.id)
      .sort((a, b) => a.sort_order - b.sort_order)
    for (const [i, o] of offers.entries()) {
      const supplier = await one(
        `insert into public.request_canvass_suppliers
           (canvass_id, supplier_name, odoo_supplier_id, currency, valid_until, lead_time, quality_note, sort_order, created_by, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [canvass.id, o.supplier_name, o.odoo_supplier_id, o.currency ?? "PHP", o.valid_until, o.lead_time,
         o.quality_note, i, o.created_by, o.created_at, o.updated_at],
      )
      const price = priceOf.get(o.id)
      await client.query(
        "insert into public.request_canvass_supplier_prices (supplier_id, comparison_rate) values ($1, $2)",
        [supplier.id, price?.comparison_rate ?? null],
      )
      const quote = await one(
        `insert into public.request_canvass_quotes
           (canvass_id, supplier_id, item_id, brand, description, source_link, brochure, remarks, created_by, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
        [canvass.id, supplier.id, item.id, o.brand, o.description, o.source_link,
         JSON.stringify(o.brochure ?? []), o.remarks, o.created_by, o.created_at],
      )
      await client.query(
        "insert into public.request_canvass_quote_prices (quote_id, unit_price) values ($1, $2)",
        [quote.id, price?.unit_price ?? null],
      )
    }
    const after = await one("select status from public.purchase_request_items where id = $1", [item.id])
    report.push(
      `${c.number} -> ${canvass.number}: ${offers.length} supplier(s), ${offers.length} quote(s) on its Requested Item` +
        (after.status !== item.status ? ` (line status ${item.status} -> ${after.status})` : ""),
    )
  }

  if (apply) {
    await client.query("commit")
  } else {
    await client.query("rollback")
    await client.query(`select setval('${SEQ}', $1, $2)`, [seqBefore.last_value, seqBefore.is_called])
  }
} catch (err) {
  await client.query("rollback").catch(() => {})
  await client.query(`select setval('${SEQ}', $1, $2)`, [seqBefore.last_value, seqBefore.is_called]).catch(() => {})
  await client.end()
  console.error(`Not carried over, nothing changed: ${err.message}`)
  process.exit(1)
}
await client.end()

console.log(`${apply ? "APPLIED" : "DRY RUN (rolled back)"} on ${target}:`)
for (const line of report) console.log("  " + line)
if (!report.length) console.log("  nothing to carry over")
