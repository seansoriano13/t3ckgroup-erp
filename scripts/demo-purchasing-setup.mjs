#!/usr/bin/env node
/**
 * Gets STAGING ready for the Purchasing demo (docs/demos/purchasing-demo-run-sheet.html).
 * Staging only. Three jobs, in one transaction:
 *
 *   1. Demo cast: one-word logins `<first name>@demo`, password `demo`, for every
 *      person the SOR happy path needs (sales, purchaser, finance, signers,
 *      warehouse, technical). Idempotent, like seed-mock-employees.mjs.
 *   2. Purchasing settings back to the demo's: IPAS sign-off lists, Transmittal
 *      staff lists and S0 Evaluation lists are refilled with the cast (DEMO_LISTS),
 *      the "Government" markup preset (1.30) is the only active one, ageing rules
 *      are blank and the Evaluation template is cleared. Option lists (payment
 *      methods etc.) and costing rates are left as they are: they are the defaults,
 *      not a choice.
 *   3. Requested Items (#678): the demo Purchase Requests list every S0 line as a Not
 *      checked item, the shape the app now keeps by itself.
 *   4. "Project [FOR DEMO]": the production "Project" Sales Flow, copied from
 *      its latest Flow Snapshot under NEW ids (staging already has the real
 *      Project under the same ids), left as a draft so the demo can add the
 *      purchasing Stage Actions and Conditions and Publish it. A copy from an
 *      earlier run is renamed, archived, and its SORs soft-deleted.
 *
 * Without --apply it rolls back at the end, so the default run is a rehearsal.
 *
 *   node scripts/demo-purchasing-setup.mjs           # dry run
 *   node scripts/demo-purchasing-setup.mjs --apply
 */
import pg from "pg"
import { randomUUID } from "crypto"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

export const DEMO_PASSWORD = "demo"
export const DEMO_DOMAIN = "demo"
export const DEMO_SALE_TYPE = "Project [FOR DEMO]"
const PROD_SALE_TYPE = "Project"

// Named after the real staff (first names and call signs) so the room recognises them, with
// "demo" after the name so nobody mistakes a demo signature for the real person's.
// `was`: earlier keys of the same login, renamed in place so their SORs and sign-offs follow.
export const DEMO = {
  "dani": { was: ["sales"], name: "Dani demo", department: "SALES", sub_department: "GOV", role: "SALES EXECUTIVE", has_sales_flow: true, has_retail_access: true },
  "cjay": { was: ["purchaser"], name: "Cjay demo", department: "OPERATIONS", sub_department: "PURCHASING", role: "PURCHASER", has_purchasing_flow: true, has_task_flow: true },
  "jelai": { was: ["finance"], name: "Jelai demo", department: "ADMIN", sub_department: "FINANCE", role: "ACCOUNTING STAFF", has_task_flow: true, has_finance_flow: true },
  "jen": { was: ["admin"], name: "Jen demo", department: "ADMIN", sub_department: "ADMIN", role: "ADMIN MANAGER", is_head: true, has_task_flow: true },
  "grace": { was: ["ops"], name: "Grace demo", department: "OPERATIONS", role: "OPERATIONS MANAGER", is_head: true, has_task_flow: true },
  "201": { was: ["gm"], name: "201 demo", department: "ADMIN", sub_department: "ADMIN", role: "GENERAL MANAGER", is_head: true, has_task_flow: true },
  // 101 is both the Sales Director and the Super Admin, so one login does both.
  "101": { was: ["boss", "saleshead"], name: "101 demo", department: "SALES", role: "SALES DIRECTOR", is_head: true, has_sales_flow: true, has_retail_access: true, is_super_admin: true, can_edit_sales_flows: true },
  "aldrin": { was: ["warehouse"], name: "Aldrin demo", department: "OPERATIONS", sub_department: "WAREHOUSE", role: "WAREHOUSE STAFF", has_task_flow: true },
  "sherwin": { was: ["technical"], name: "Sherwin demo", department: "OPERATIONS", sub_department: "TECHNICAL", role: "TECHNICIAN", has_task_flow: true },
}

/** Moves a login to a new email, keeping its id (auth user, identity and employee row). */
async function renameLogin(c, id, email) {
  await c.query("update auth.users set email = $2, updated_at = now() where id = $1", [id, email])
  await c.query("update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text) where user_id = $1", [id, email])
  await c.query("update public.employees set email = $2 where id = $1", [id, email])
}

// Who sits on each list after a reset. IPAS s1 = section 1, s3 = section 2, s6 = section 3,
// s7_* = section 4. The Markup list is 201 (101 is a Super Admin); Final Acquire is kept only
// because it is the list that may unlock a Go.
export const DEMO_LISTS = {
  ipas_signer_lists: {
    s1_approved: ["101"], s3_approved: ["101"], s6_approved: ["jelai"],
    s7_received: ["grace"], s7_noted: ["101"], s7_checked: ["201"], s7_approved: ["201"],
    logistics_signed: ["aldrin"],
    transmittal_warehouse: ["aldrin"], transmittal_technical: ["sherwin"], transmittal_logistics: ["aldrin"],
    transmittal_check_by: ["jen", "grace"],
  },
  costing_signer_lists: {
    markup: ["201"], final_acquire: ["201"], evaluation: ["grace"], team_rrd: ["sherwin"], team_ioe: ["sherwin"],
  },
}
export const DEMO_PRESET = { label: "Government", factor: 1.3 }

const FLAGS = ["is_head", "is_hr", "is_super_admin", "can_manage_leaves", "can_edit_sales_flows", "has_sales_flow", "has_task_flow", "has_purchasing_flow", "has_finance_flow", "has_retail_access"]

async function connect(url) {
  const client = new pg.Client({ connectionString: url, ssl: url.includes("127.0.0.1") ? false : { rejectUnauthorized: false } })
  await client.connect()
  return client
}

async function seedCast(c) {
  for (const [key, spec] of Object.entries(DEMO)) {
    const email = `${key}@${DEMO_DOMAIN}`
    const existing = await c.query("select id from auth.users where email = $1", [email])
    let id = existing.rows[0]?.id
    for (const old of id ? [] : spec.was ?? []) {
      const { rows: [prev] } = await c.query("select id from auth.users where email = $1", [`${old}@${DEMO_DOMAIN}`])
      if (!prev) continue
      await renameLogin(c, prev.id, email)
      console.log(`  renamed ${old}@${DEMO_DOMAIN} → ${email}`)
      id = prev.id
      break
    }
    if (id) {
      await c.query(
        "update auth.users set encrypted_password = crypt($2, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1",
        [id, DEMO_PASSWORD],
      )
    } else {
      id = (
        await c.query(
          `insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
             confirmation_token, recovery_token, email_change_token_new, email_change, phone_change, phone_change_token,
             raw_app_meta_data, raw_user_meta_data, aud, role)
           values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', $1, crypt($2, gen_salt('bf')), now(), now(), now(),
             '', '', '', '', '', '', '{"provider":"email","providers":["email"]}', '{}', 'authenticated', 'authenticated')
           returning id`,
          [email, DEMO_PASSWORD],
        )
      ).rows[0].id
      await c.query(
        `insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         values (gen_random_uuid(), $1::uuid, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now(), now())`,
        [id, email],
      )
    }
    const flags = FLAGS.map((f) => spec[f] ?? false)
    await c.query(
      `insert into public.employees (id, email, name, department, sub_department, role, employment_status, is_deleted, is_issued_password, ${FLAGS.join(", ")})
       values ($1, $2, $3, $4, $5, $6, 'Regular', false, false, ${FLAGS.map((_, i) => `$${i + 7}`).join(", ")})
       on conflict (id) do update set email = excluded.email, name = excluded.name, department = excluded.department,
         sub_department = excluded.sub_department, role = excluded.role, is_deleted = false,
         ${FLAGS.map((f) => `${f} = excluded.${f}`).join(", ")}`,
      [id, email, spec.name, spec.department, spec.sub_department ?? null, spec.role, ...flags],
    )
    console.log(`  ok  ${email}`)
  }
  // A demo login no longer in the cast (folded into another) is switched off, not deleted:
  // it may still hold a role on an earlier rehearsal's SOR.
  const keep = Object.keys(DEMO).map((k) => `${k}@${DEMO_DOMAIN}`)
  const { rows: stale } = await c.query(
    "select id, email from public.employees where email like $1 and not (email = any($2::text[])) and is_deleted is not true",
    [`%@${DEMO_DOMAIN}`, keep],
  )
  for (const row of stale) {
    await c.query(`update public.employees set is_deleted = true, ${FLAGS.map((f) => `${f} = false`).join(", ")} where id = $1`, [row.id])
    await c.query("update auth.users set encrypted_password = crypt(gen_random_uuid()::text, gen_salt('bf')), updated_at = now() where id = $1", [row.id])
    console.log(`  off ${row.email} (no longer in the cast)`)
  }
}

async function resetSettings(c) {
  const n = async (sql) => (await c.query(sql)).rowCount
  console.log(`  IPAS sign-off and Transmittal staff lists: ${await n("delete from public.ipas_signer_lists")} rows removed`)
  console.log(`  S0 Evaluation lists: ${await n("delete from public.costing_signer_lists")} rows removed`)
  for (const [table, lists] of Object.entries(DEMO_LISTS)) {
    for (const [listKey, keys] of Object.entries(lists)) {
      const emails = keys.map((k) => `${k}@${DEMO_DOMAIN}`)
      const added = await c.query(
        `insert into public.${table} (list_key, employee_id)
         select $1, e.id from public.employees e where e.email = any($2::text[])
         on conflict do nothing`,
        [listKey, emails],
      )
      if (added.rowCount !== keys.length) throw new Error(`${table}.${listKey}: added ${added.rowCount} of ${keys.join(", ")}`)
    }
    console.log(`  ${table}: ${Object.keys(lists).length} lists filled with the cast`)
  }
  console.log(`  Ageing rules blanked: ${await n("update public.order_ageing_rules set days = null, updated_at = now() where days is not null")}`)
  console.log(`  Evaluation template cleared: ${await n("update public.costing_evaluation_settings set evaluation_template_id = null, updated_at = now() where evaluation_template_id is not null")}`)
  // A preset a matrix already used stays (deactivated); an unused one goes. Then the demo's one.
  const used = await n("update public.costing_markup_presets p set active = false, updated_at = now() where exists (select 1 from public.costing_matrix_money m where m.default_preset_id = p.id)")
  const gone = await n("delete from public.costing_markup_presets p where not exists (select 1 from public.costing_matrix_money m where m.default_preset_id = p.id)")
  const revived = await n(`update public.costing_markup_presets set factor = ${DEMO_PRESET.factor}, active = true, updated_at = now() where label = '${DEMO_PRESET.label}'`)
  if (!revived) await c.query("insert into public.costing_markup_presets (label, factor, sort, active) values ($1, $2, 0, true)", [DEMO_PRESET.label, DEMO_PRESET.factor])
  console.log(`  Markup presets: ${gone} removed, ${used} deactivated (used by a matrix), "${DEMO_PRESET.label}" ${DEMO_PRESET.factor} is the active one`)
}

/** Every id the flow owns inside a snapshot, so the copy can live beside the real Project. */
function ownedIds(snapshot, saleTypeId, flowId) {
  const ids = new Set([saleTypeId, flowId])
  const data = snapshot.snapshot_data
  for (const key of ["stages", "edges", "actions", "conditions", "stageFields", "formFields"]) {
    for (const row of data[key] ?? []) if (row?.id) ids.add(row.id)
  }
  return ids
}

/**
 * Frees the demo's Odoo POs for the next rehearsal: every IPAS naming an SOR of
 * the old copy is reopened (if filed) by 101 (the demo Super Admin) and cancelled by
 * Cjay (the demo Purchaser), through the same functions the screen uses. One live
 * IPAS per PO is the rule.
 */
async function freeDemoPos(c, saleTypeId) {
  const { rows: ipas } = await c.query(
    `select distinct i.id, i.number, i.po_number, i.state from public.ipas i
       join public.ipas_sors s on s.ipas_id = i.id
       join public.sales_opportunities o on o.id = s.opportunity_id
      where o.sale_type_id = $1 and i.state <> 'cancelled'`,
    [saleTypeId],
  )
  if (ipas.length === 0) return
  const actAs = async (key) => {
    const email = `${key}@${DEMO_DOMAIN}`
    const { rows: [who] } = await c.query("select id from public.employees where email = $1", [email])
    await c.query("reset role")
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.id, email, role: "authenticated" })])
    await c.query("set local role authenticated")
  }
  for (const row of ipas) {
    if (row.state === "filed") {
      await actAs("101")
      await c.query("select public.ipas_reopen($1, $2)", [row.id, "Demo reset"])
    }
    await actAs("cjay")
    await c.query("select public.ipas_cancel($1, $2)", [row.id, "Demo reset: frees the PO for the next rehearsal"])
    console.log(`  cancelled ${row.number} (${row.po_number} is free again)`)
  }
  await c.query("reset role")
}

async function retireOldCopies(c) {
  const { rows } = await c.query("select id, name from public.sale_types where name = $1 and archived_at is null", [DEMO_SALE_TYPE])
  for (const old of rows) {
    await freeDemoPos(c, old.id)
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
    const sors = await c.query("update public.sales_opportunities set is_deleted = true where sale_type_id = $1 and is_deleted is not true", [old.id])
    await c.query("update public.sale_types set name = $2, archived_at = now() where id = $1", [old.id, `${DEMO_SALE_TYPE} (old ${stamp})`])
    console.log(`  retired the earlier copy (${sors.rowCount} SORs soft-deleted)`)
  }
}

/**
 * #678: the demo's Requested Items in the new shape. Items on the Purchase Requests of the demo
 * SORs (any copy of the demo Sale Type, old ones included) are cleared, then one Not checked
 * item is made for every S0 line by the same function the database trigger uses. Staging only,
 * demo SORs only.
 */
async function resetDemoItems(c) {
  const { rows: requests } = await c.query(
    `select r.id from public.purchase_requests r
       join public.sales_opportunities o on o.id = r.opportunity_id
       join public.sale_types t on t.id = o.sale_type_id
      where t.name = $1 or t.name like $2`,
    [DEMO_SALE_TYPE, `${DEMO_SALE_TYPE} (old %`],
  )
  for (const { id } of requests) {
    await c.query("delete from public.purchase_request_items where request_id = $1", [id])
    await c.query("select public._purchase_request_sync_sor_items($1)", [id])
  }
  console.log(`  ${requests.length} demo request(s) now list their S0 lines as Not checked items`)
}

async function copyProjectFlow(prod, c) {
  const { rows: types } = await prod.query("select * from public.sale_types where name = $1 and archived_at is null", [PROD_SALE_TYPE])
  if (types.length !== 1) throw new Error(`Prod has ${types.length} active Sale Types named "${PROD_SALE_TYPE}".`)
  const saleType = types[0]
  const { rows: [flow] } = await prod.query("select * from public.sales_flows where sale_type_id = $1", [saleType.id])
  const { rows: [snapshot] } = await prod.query(
    "select * from public.flow_snapshots where flow_id = $1 order by version desc, version_minor desc limit 1",
    [flow.id],
  )
  if (!snapshot) throw new Error("Prod's Project flow has no Flow Snapshot to copy.")

  const map = new Map([...ownedIds(snapshot, saleType.id, flow.id)].map((id) => [id, randomUUID()]))
  let text = JSON.stringify(snapshot.snapshot_data)
  for (const [from, to] of map) text = text.split(from).join(to)
  const data = JSON.parse(text)

  // What is left are people and groups. Groups the copy names must exist on staging.
  const refs = [...new Set(text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [])]
    .filter((id) => ![...map.values()].includes(id))
  const known = new Set()
  for (const table of ["employees", "employee_groups", "group_task_templates", "costing_markup_presets", "flow_stages"]) {
    const { rows } = await c.query(`select id from public.${table} where id = any($1::uuid[])`, [refs])
    rows.forEach((r) => known.add(r.id))
  }
  const missing = refs.filter((id) => !known.has(id))
  if (missing.length) console.log(`  note: ${missing.length} id(s) in the copy are not on staging (left as they are): ${missing.join(", ")}`)

  const saleTypeId = map.get(saleType.id)
  const flowId = map.get(flow.id)
  await c.query("insert into public.sale_types (id, name) values ($1, $2)", [saleTypeId, DEMO_SALE_TYPE])
  await c.query("insert into public.sales_flows (id, sale_type_id, state) values ($1, $2, 'draft')", [flowId, saleTypeId])
  const snapshotId = randomUUID()
  await c.query(
    "insert into public.flow_snapshots (id, flow_id, version, version_minor, snapshot_data, note) values ($1, $2, $3, $4, $5, $6)",
    [snapshotId, flowId, snapshot.version, snapshot.version_minor, JSON.stringify(data), `Copied from production "${PROD_SALE_TYPE}" v${snapshot.version}.${snapshot.version_minor} for the Purchasing demo`],
  )
  await c.query("select public.restore_flow_snapshot($1, $2)", [flowId, snapshotId])
  const { rows: [counts] } = await c.query(
    `select (select count(*) from public.flow_stages where flow_id = $1) stages,
            (select count(*) from public.flow_edges where flow_id = $1) edges,
            (select count(*) from public.flow_stage_actions a join public.flow_stages s on s.id = a.stage_id where s.flow_id = $1) actions,
            (select count(*) from public.stage_conditions x join public.flow_stages s on s.id = x.stage_id where s.flow_id = $1) conditions`,
    [flowId],
  )
  console.log(`  ✔ "${DEMO_SALE_TYPE}" from prod v${snapshot.version}.${snapshot.version_minor}: ${counts.stages} Stages, ${counts.edges} moves, ${counts.actions} actions, ${counts.conditions} conditions (draft)`)
}

async function main() {
  const apply = process.argv.includes("--apply")
  const env = loadDotEnvLocal(repoRoot)
  const stagingUrl = env.STAGING_DB_URL ?? process.env.STAGING_DB_URL
  const prodUrl = env.PROD_DB_URL ?? process.env.PROD_DB_URL
  if (!stagingUrl || !prodUrl) throw new Error("STAGING_DB_URL and PROD_DB_URL must be set (.env.local or the environment).")
  if (stagingUrl === prodUrl) throw new Error("STAGING_DB_URL and PROD_DB_URL are the same database.")

  const prod = await connect(prodUrl)
  const c = await connect(stagingUrl)
  console.log(apply ? "APPLYING to STAGING" : "DRY RUN on STAGING (rolls back; pass --apply to commit)")
  try {
    await c.query("begin")
    console.log("1. Demo cast")
    await seedCast(c)
    console.log("2. Purchasing settings reset")
    await resetSettings(c)
    console.log(`3. ${DEMO_SALE_TYPE}`)
    await retireOldCopies(c)
    await copyProjectFlow(prod, c)
    console.log("4. Demo Requested Items (one per S0 line)")
    await resetDemoItems(c)
    await c.query(apply ? "commit" : "rollback")
    console.log(apply ? "\nCommitted." : "\nRolled back (dry run).")
  } catch (e) {
    await c.query("rollback").catch(() => {})
    throw e
  } finally {
    await prod.end()
    await c.end()
  }
}

main().catch((e) => {
  console.error(`\n✖ ${e.message}\n  Nothing was written.`)
  process.exit(1)
})
