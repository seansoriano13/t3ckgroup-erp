#!/usr/bin/env node
/**
 * Seeds mock data for the Purchasing tabs: Purchase Requests, IPAS and
 * Packing Lists (Transmittals already have plenty and are left alone).
 *
 * Everything it adds hangs off three mock SORs whose client is "Mock Client …",
 * so a re-run sees them and stops instead of adding twice. Add-only: it never
 * deletes or changes a row it did not create.
 *
 *   node scripts/seed-mock-purchasing.mjs            # local stack
 *   node scripts/seed-mock-purchasing.mjs --staging  # STAGING_DB_URL
 */
import pg from "pg"
import path from "path"
import { fileURLToPath } from "url"
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const MARK = "Mock Client"

const SORS = [
  { client: `${MARK} Alpha Corp`, title: "Mock: Office laptops for Alpha", ref: "S990001" },
  { client: `${MARK} Beta Foundation`, title: "Mock: Water pumps for Beta", ref: "S990002" },
  { client: `${MARK} Gamma LGU`, title: "Mock: Solar lamps for Gamma", ref: "S990003" },
]

const ITEM_NAMES = [
  ["Laptop 14in i5", "pc", 10],
  ["USB-C docking station", "pc", 10],
  ["Submersible pump 1HP", "pc", 4],
  ["PVC pipe 2in x 3m", "length", 60],
  ["Solar lamp 20W", "pc", 120],
  ["Lithium battery 12V", "pc", 30],
  ["Mounting bracket", "pc", 120],
  ["Cable ties (pack)", "pack", 15],
  ["Network switch 24-port", "pc", 2],
]
const ITEM_STATUSES = ["not_checked", "to_purchase", "still_canvassing", "purchased", "received", "available", "cannot_source", "cancelled", "not_checked"]

const pick = (i, arr) => arr[i % arr.length]

async function main() {
  const env = loadDotEnvLocal(repoRoot)
  const staging = process.argv.includes("--staging")
  const url = staging
    ? env.STAGING_DB_URL ?? process.env.STAGING_DB_URL
    : process.env.LOCAL_DB_URL || env.LOCAL_DB_URL || DEFAULT_LOCAL_DB_URL
  if (!url) throw new Error("STAGING_DB_URL is not set (.env.local or the environment).")
  console.log(staging ? "Target: STAGING" : "Target: LOCAL stack")
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  const q = async (sql, params) => (await c.query(sql, params)).rows
  try {
    if ((await q("select 1 from sales_opportunities where client_name like $1 limit 1", [`${MARK}%`])).length) {
      console.log("Mock purchasing data is already there. Nothing added.")
      return
    }
    const emps = await q("select id, email from employees where coalesce(is_deleted,false) = false order by (email in ('purchaser@mock.t3ck.test', 'purchaser@local')) desc, (email like '%@policy.fixture') asc, (email like 'super-admin%') desc, email")
    if (emps.length < 2) throw new Error("Need at least two employees. Run seed-mock-employees.mjs first.")
    const buyer = emps[0].id
    const people = emps.map((e) => e.id)

    await c.query("begin")

    // --- Mock SORs -------------------------------------------------------
    const sorIds = []
    for (const s of SORS) {
      const [r] = await q(
        `insert into sales_opportunities (registered_by, lead_source, client_name, project_title, sales_reference, status, expected_value, deal_owner_id)
         values ($1, 'Referral', $2, $3, $4, 'LEAD', $5, $1) returning id`,
        [pick(1, people), s.client, s.title, s.ref, 250000 + sorIds.length * 175000],
      )
      sorIds.push(r.id)
    }

    // --- Purchase Requests ----------------------------------------------
    // Project requests on each SOR, plus Direct (no SOR) ones; some unassigned, some closed.
    const requests = [
      { sor: 0, title: null, buyer, items: [0, 1, 7] },
      { sor: 1, title: null, buyer: null, items: [2, 3] },
      { sor: 2, title: null, buyer, items: [4, 5, 6] },
      { sor: null, title: "Mock: Replacement office chairs", buyer: null, items: [8] },
      { sor: null, title: "Mock: Printer toner for HR", buyer, items: [7, 1] },
      { sor: null, title: "Mock: Pantry supplies", buyer, items: [] },
    ]
    let prCount = 0
    for (const [ri, rq] of requests.entries()) {
      const requester = pick(ri + 2, people)
      const [pr] = await q(
        `insert into purchase_requests (opportunity_id, buyer_id, created_by, title, access_until, requesters)
         values ($1, $2, $3, $4, $5, '[]'::jsonb) returning id`,
        [rq.sor == null ? null : sorIds[rq.sor], rq.buyer, requester, rq.title, "terminal"],
      )
      prCount++
      await q(
        "insert into purchase_request_members (request_id, employee_id, side, added_by) values ($1,$2,'requester',$2)",
        [pr.id, requester],
      )
      if (rq.buyer) await q("insert into purchase_request_members (request_id, employee_id, side, added_by) values ($1,$2,'purchasing',$2)", [pr.id, rq.buyer])
      for (const [k, idx] of rq.items.entries()) {
        const [name, unit, qty] = ITEM_NAMES[idx]
        // Last request is fully closed so the Closed filter has rows.
        const status = ri === 4 ? (k === 0 ? "received" : "cancelled") : pick(idx + ri, ITEM_STATUSES)
        const ordered = status === "purchased" || status === "received"
        await q(
          `insert into purchase_request_items (request_id, source, name, unit, quantity, description, status, po_number, po_verification, requested_by, status_changed_by, status_changed_at)
           values ($1,'new',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [pr.id, name, unit, qty, `Mock item for testing (${name}).`, status,
            ordered ? `P99${ri}0${k}0` : null, ordered ? "UNVERIFIED" : "UNVERIFIED", requester,
            status === "not_checked" ? null : buyer, status === "not_checked" ? null : new Date()],
        )
      }
      await q(
        "insert into purchase_request_messages (request_id, author_id, content) values ($1,$2,$3),($1,$4,$5)",
        [pr.id, requester, "Hi Purchasing, can you source these please?", buyer, "Noted. Checking stock and suppliers first."],
      )
    }

    // --- IPAS ------------------------------------------------------------
    const opt = async (list, label) => (await q("select id from ipas_options where list=$1 and label=$2", [list, label]))[0]?.id
    const freight = await opt("freight_service", "DHL")
    const bankTt = await opt("payment_method", "Bank TT")
    const cash = await opt("payment_method", "Cash")
    const brokerage = await opt("charge_kind", "Brokerage Fee")
    const duties = await opt("charge_kind", "Duties & Taxes")

    const ipasSpecs = [
      { po: "P9900001", src: "import", purpose: "project", pri: "high", supplier: "Shenzhen Brightway Electronics", sor: 0, state: "open", pays: [["down_payment", 2400, bankTt]], charges: [], ship: true },
      { po: "P9900002", src: "import", purpose: "project", pri: "very_high", supplier: "Guangzhou Aqua Pumps Ltd", sor: 1, state: "open", pays: [["down_payment", 3000, bankTt], ["full_payment", 4500, bankTt]], charges: [[brokerage, 18500], [duties, 64200]], ship: true },
      { po: "P9900003", src: "local", purpose: "project", pri: "medium", supplier: "Manila Solar Trading", sor: 2, state: "open", pays: [["full_payment", 98000, cash]], charges: [] },
      { po: "P9900004", src: "local", purpose: "supplies", pri: "medium", supplier: "Office Depot Marikina", sor: null, state: "open", pays: [], charges: [] },
      { po: "P9900005", src: "import", purpose: "inventory", pri: "high", supplier: "Ningbo Cable Works", sor: null, state: "cancelled", pays: [], charges: [] },
    ]
    let ipasCount = 0
    for (const [i, s] of ipasSpecs.entries()) {
      const lines = [
        { name: pick(i, ITEM_NAMES)[0], quantity: 10 + i, unit: "pc", price_unit: 120 + i * 15, price_subtotal: (10 + i) * (120 + i * 15) },
        { name: pick(i + 3, ITEM_NAMES)[0], quantity: 5, unit: "pc", price_unit: 80, price_subtotal: 400 },
      ]
      // The PO's totals, as a current Odoo copy carries them (#596): VAT on a local PO only.
      const untaxed = lines.reduce((sum, l) => sum + l.price_subtotal, 0)
      const tax = s.src === "local" ? Math.round(untaxed * 0.12 * 100) / 100 : 0
      const copy = {
        supplier: { id: 9000 + i, name: s.supplier, contact: `sales@supplier${i}.example` },
        po: { id: 7000 + i, name: s.po, state: "purchase", currency: s.src === "import" ? "USD" : "PHP", partner_ref: `PI-MOCK-${i + 1}`, origin: s.sor == null ? null : SORS[s.sor].ref, company: "T3CK GROUP", amount_untaxed: untaxed, amount_tax: tax, amount_total: untaxed + tax },
        lines,
      }
      const cancelled = s.state === "cancelled"
      const [ip] = await q(
        `insert into ipas (po_number, priority, source, purpose, odoo_copy, state, cancel_reason, cancelled_at, created_by, freight_service_id, landed_cost_split, pi_qt_amount, remarks, shipped_out_on, onboard_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'value',$11,$12,$13,$14) returning id`,
        [s.po, s.pri, s.src, s.purpose, JSON.stringify(copy), s.state,
          cancelled ? "Supplier could not deliver in time (mock)." : null, cancelled ? new Date() : null,
          buyer, s.src === "import" ? freight : null, i === 0 ? untaxed + tax : 15000 + i * 5000, "Mock IPAS for testing.",
          s.ship ? "2026-09-20" : null, s.ship ? "2026-09-24" : null],
      )
      ipasCount++
      if (s.sor != null) await q("insert into ipas_sors (ipas_id, opportunity_id) values ($1,$2)", [ip.id, sorIds[s.sor]])
      for (const [kind, amount, method] of s.pays) {
        await q(
          "insert into ipas_payments (ipas_id, kind, paid_on, amount, method_id, created_by) values ($1,$2,'2026-09-15',$3,$4,$5)",
          [ip.id, kind, amount, method, buyer],
        )
      }
      for (const [kindId, amount] of s.charges) {
        await q("insert into ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by) values ($1,$2,'2026-10-01',$3,$4)", [ip.id, kindId, amount, buyer])
      }
    }

    // --- Packing Lists ---------------------------------------------------
    const boxes = [
      ["BOX 1/2", "SEAL-0001", 18.5, [["Laptop 14in i5", 6, "pc"], ["USB-C docking station", 6, "pc"]]],
      ["BOX 2/2", "SEAL-0002", 12.2, [["Laptop 14in i5", 4, "pc"], ["Cable ties (pack)", 10, "pack"]]],
    ]
    let plCount = 0
    for (const [i, state] of ["draft", "packed", "draft"].entries()) {
      const [pl] = await q(
        "insert into packing_lists (opportunity_id, odoo_delivery_ref, state, created_by) values ($1,$2,'draft',$3) returning id",
        [sorIds[i], `WH/OUT/9900${i + 1}`, buyer],
      )
      plCount++
      if (i < 2) {
        for (const [bi, [marks, seal, kg, contents]] of boxes.entries()) {
          const [box] = await q(
            "insert into packing_list_boxes (packing_list_id, box_no, marks, seal_no, gross_weight_kg) values ($1,$2,$3,$4,$5) returning id",
            [pl.id, bi + 1, marks, seal, kg],
          )
          for (const [pos, [desc, qty, unit]] of contents.entries()) {
            await q("insert into packing_list_contents (box_id, position, description, quantity, unit) values ($1,$2,$3,$4,$5)", [box.id, pos + 1, desc, qty, unit])
          }
        }
      }
      if (state === "packed") await q("update packing_lists set state='packed', packed_by=$2, packed_at=now() where id=$1", [pl.id, pick(3, people)])
    }

    await c.query("commit")
    console.log(`Added: ${sorIds.length} SORs, ${prCount} Purchase Requests, ${ipasCount} IPAS, ${plCount} Packing Lists.`)
  } catch (e) {
    await c.query("rollback").catch(() => {})
    throw e
  } finally {
    await c.end()
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
