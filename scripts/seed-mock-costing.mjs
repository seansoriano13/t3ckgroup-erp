#!/usr/bin/env node
/**
 * Seeds mock Costing Matrices for the Costing Matrix page (#606) and the SOR's
 * Planned vs Actual Revenue (#605), on the mock SORs of seed-mock-purchasing.mjs
 * (run that first) plus one more of its own. Each SOR shows a different case:
 *
 *   Epsilon Final Offers, Final Acquire, both Components bought through an
 *           import IPAS at LC Odoo Done: Actual Revenue is final
 *   Beta    Final Offers and Final Acquire, nothing bought yet: no Actual
 *           (short: the purchasing seed's IPAS on it is still open)
 *   Gamma   one Component bought through a local IPAS still at Encoded:
 *           Actual Revenue is an estimate (the IPAS is short of LC Odoo Done)
 *   Delta   a Tender Line with no Final Offer yet: no Planned Revenue
 *
 * Add-only: a re-run sees the mock matrices and stops. It never deletes or
 * changes a row it did not create.
 *
 *   node scripts/seed-mock-costing.mjs            # local stack
 *   node scripts/seed-mock-costing.mjs --staging  # STAGING_DB_URL
 */
import pg from "pg"
import path from "path"
import { fileURLToPath } from "url"
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const MARK = "Mock Client"

// [specification, unit, quantity, Final Offer unit, components: [name, quantity, Final Acquire unit, bought line id]]
const MATRICES = {
  "Epsilon School": {
    lines: [
      ["Laptop 14in i5, 16GB RAM, 512GB SSD", "pc", 10, 62000, [["Laptop 14in i5", 10, 48000, 99210001]]],
      ["USB-C docking station with 100W charging", "pc", 10, 9500, [["USB-C docking station", 10, 7200, 99210002]]],
    ],
    costRows: [["Delivery and installation", 1, 15000]],
    title: "Mock: Laptops for Epsilon",
    ref: "S990005",
    ipas: { po: "P9900021", currency: "USD", status: "lc_odoo_done", supplier: "Shenzhen Brightway Electronics", paidPhp: true },
  },
  "Beta Foundation": {
    lines: [
      ["Submersible pump 1HP, stainless", "pc", 4, 38500, [["Submersible pump 1HP", 4, 29000, null]]],
      ["PVC pipe 2in x 3m, schedule 40", "length", 60, 950, [["PVC pipe 2in x 3m", 60, 610, null]]],
    ],
    costRows: [["Trucking to site", 1, 12000]],
  },
  "Gamma LGU": {
    lines: [
      ["Solar street lamp 20W with pole", "set", 120, 14800, [
        ["Solar lamp 20W", 120, 8900, 99230001],
        ["Mounting bracket", 120, 650, null],
      ]],
    ],
    costRows: [],
    ipas: { po: "P9900023", currency: "PHP", status: "encoded", supplier: "Manila Solar Trading", paidPhp: false },
  },
  "Delta Hospital": {
    title: "Mock: Hospital beds for Delta",
    ref: "S990004",
    lines: [
      ["Hospital bed, 3-crank manual", "pc", 8, null, [["Hospital bed 3-crank", 8, 31000, null]]],
      ["Over-bed table", "pc", 8, 5200, [["Over-bed table", 8, 3100, null]]],
    ],
    costRows: [],
  },
}

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
    const sors = await q("select id, client_name, registered_by from sales_opportunities where client_name like $1", [`${MARK}%`])
    if (sors.length === 0) throw new Error("No mock SORs. Run seed-mock-purchasing.mjs first.")
    const ids = sors.map((s) => s.id)
    if ((await q("select 1 from costing_matrices where opportunity_id = any($1) limit 1", [ids])).length) {
      console.log("Mock Costing Matrices are already there. Nothing added.")
      return
    }
    const emps = await q("select id from employees where coalesce(is_deleted,false) = false order by (email in ('purchaser@mock.t3ck.test', 'purchaser@local')) desc, (email like '%@policy.fixture') asc, (email like 'super-admin%') desc, email")
    const buyer = emps[0].id

    await c.query("begin")

    const bankTt = (await q("select id from ipas_options where list='payment_method' and label='Bank TT'"))[0]?.id ?? null
    const brokerage = (await q("select id from ipas_options where list='charge_kind' and label='Brokerage Fee'"))[0]?.id ?? null
    const freight = (await q("select id from ipas_options where list='freight_service' and label='DHL'"))[0]?.id ?? null

    let made = { sors: 0, matrices: 0, ipas: 0 }
    for (const [client, spec] of Object.entries(MATRICES)) {
      let sor = sors.find((s) => s.client_name === `${MARK} ${client}`)
      if (!sor) {
        ;[sor] = await q(
          `insert into sales_opportunities (registered_by, lead_source, client_name, project_title, sales_reference, status, expected_value, deal_owner_id)
           values ($1, 'Referral', $2, $3, $4, 'LEAD', 640000, $1) returning id, client_name, registered_by`,
          [buyer, `${MARK} ${client}`, spec.title, spec.ref],
        )
        made.sors++
      }
      const [m] = await q(
        "insert into costing_matrices (opportunity_id, sales_incharge_id, purchasing_incharge_id) values ($1,$2,$3) returning id",
        [sor.id, sor.registered_by, buyer],
      )
      made.matrices++

      // The components bought, for the IPAS and the Requested Items below.
      const bought = []
      for (const [li, [specText, unit, qty, offer, comps]] of spec.lines.entries()) {
        const [t] = await q(
          "insert into costing_tender_lines (matrix_id, position, tender_specification, unit, quantity, created_by) values ($1,$2,$3,$4,$5,$6) returning id",
          [m.id, li + 1, specText, unit, qty, buyer],
        )
        await q("insert into costing_tender_line_prices (tender_line_id, abc_unit, final_offer_unit) values ($1,$2,$3)", [t.id, offer ? Math.round(offer * 1.08) : null, offer])
        for (const [ci, [name, cq, fa, lineId]] of comps.entries()) {
          const [comp] = await q(
            "insert into costing_components (tender_line_id, position, name, quantity, unit, brand) values ($1,$2,$3,$4,$5,'Mock Brand') returning id",
            [t.id, ci + 1, name, cq, unit],
          )
          await q(
            "insert into costing_component_costs (component_id, acquire_unit, final_acquire_unit, markup_factor) values ($1,$2,$2,1)",
            [comp.id, fa],
          )
          if (lineId) bought.push({ comp: comp.id, name, quantity: cq, unit, lineId, fa })
        }
      }
      for (const [ri, [desc, rq, fa]] of spec.costRows.entries()) {
        await q("insert into costing_cost_rows (matrix_id, position, description, quantity, acquire_unit, final_acquire_unit) values ($1,$2,$3,$4,$5,$5)", [m.id, ri + 1, desc, rq, fa])
      }

      if (spec.ipas && bought.length) {
        const usd = spec.ipas.currency === "USD"
        // Priced so the Landed Cost lands a little under Final Acquire.
        const lines = bought.map((b) => {
          const unitPrice = usd ? Math.round((b.fa * 0.78) / 56) : Math.round(b.fa * 0.9)
          return { line_id: b.lineId, product_id: 70000 + (b.lineId % 1000), name: b.name, quantity: b.quantity, unit: b.unit, price_unit: unitPrice, price_subtotal: unitPrice * b.quantity, taxes: [], analytic: [], brand: null }
        })
        const total = lines.reduce((sum, l) => sum + l.price_subtotal, 0)
        const copy = {
          supplier: { id: 9100, name: spec.ipas.supplier, contact: null },
          po: { id: 7100 + made.ipas, name: spec.ipas.po, state: "purchase", currency: spec.ipas.currency, partner_ref: `PI-${spec.ipas.po}`, origin: null, company: "T3CK GROUP", amount_untaxed: total, amount_tax: 0, amount_total: total },
          lines,
          receipts: { status: "pending", done: 0, total: 1 },
          bills: { count: 0, draft: 0 },
        }
        const [ip] = await q(
          `insert into ipas (po_number, priority, source, purpose, odoo_copy, state, created_by, freight_service_id, landed_cost_split, pi_qt_amount, computation_status, remarks)
           values ($1,'high',$2,'project',$3,'open',$4,$5,'value',$6,$7,'Mock IPAS for the Costing Matrix.') returning id`,
          [spec.ipas.po, usd ? "import" : "local", JSON.stringify(copy), buyer, usd ? freight : null, total, spec.ipas.status],
        )
        made.ipas++
        await q("insert into ipas_sors (ipas_id, opportunity_id) values ($1,$2)", [ip.id, sor.id])
        await q(
          "insert into ipas_payments (ipas_id, kind, paid_on, amount, php_debited, method_id, created_by) values ($1,'full_payment','2026-10-02',$2,$3,$4,$5)",
          [ip.id, total, usd && spec.ipas.paidPhp ? Math.round(total * 56.4) : null, bankTt, buyer],
        )
        if (brokerage) await q("insert into ipas_charges (ipas_id, kind_id, charged_on, amount_php, created_by) values ($1,$2,'2026-10-08',$3,$4)", [ip.id, brokerage, usd ? 22000 : 4500, buyer])

        // The Requested Items that bought the Components, on a Purchase Request of the SOR.
        let [pr] = await q("select id from purchase_requests where opportunity_id = $1 limit 1", [sor.id])
        if (!pr) {
          ;[pr] = await q(
            "insert into purchase_requests (opportunity_id, buyer_id, created_by, access_until, requesters) values ($1,$2,$2,'terminal','[]'::jsonb) returning id",
            [sor.id, buyer],
          )
        }
        for (const b of bought) {
          await q(
            `insert into purchase_request_items (request_id, source, name, unit, quantity, description, status, po_number, odoo_po_line_ids, requested_by, component_id, status_changed_by, status_changed_at)
             values ($1,'new',$2,$3,$4,'Mock item bought for the Costing Matrix.','ordered',$5,$6,$7,$8,$7,now())`,
            [pr.id, b.name, b.unit, b.quantity, spec.ipas.po, [b.lineId], buyer, b.comp],
          )
        }
      }
    }

    await c.query("commit")
    console.log(`Added: ${made.sors} SOR, ${made.matrices} Costing Matrices, ${made.ipas} IPAS.`)
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
