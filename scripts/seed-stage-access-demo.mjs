#!/usr/bin/env node
/**
 * Seeds the Stage-scoped access demo on staging — the Sale Type, its Sales
 * Flow, and three SORs positioned so that all four access levels
 * (`full` / `participant` / `locked` / `none`) can be shown between two
 * logins, without driving a deal through six Stages in front of the room.
 *
 * Why a purpose-built flow rather than Government: on staging today
 * `flow_stage_access`, `flow_access_settings` and `sor_stage_participants`
 * are all empty, so ADR 0021 ships but nothing exercises it. Configuring
 * Government would mutate 8 live SORs and put 17 Stages on the projector.
 *
 * The three SORs are not Scratch SORs on purpose: `is_scratch` excludes a
 * deal from `getOpportunities()`, which is the register the demo's first
 * beat compares between the two accounts.
 *
 * Idempotent: every run tears the demo Sale Type down and rebuilds it, so
 * the flow and the SOR positions are the same every time it is demoed.
 * Without --apply it rolls back at the end and changes nothing.
 *
 * Usage:
 *   node scripts/seed-stage-access-demo.mjs               # rehearsal, rolls back
 *   node scripts/seed-stage-access-demo.mjs --apply       # commits
 *   node scripts/seed-stage-access-demo.mjs --teardown --apply   # removes it entirely
 *
 * Reads STAGING_DB_URL from .env.local or the environment, like
 * scripts/db-ledger-check.mjs and scripts/transfer-sales-flows.mjs.
 */
import pg from "pg"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const SALE_TYPE = "ZZ Demo — Stage Access"
const GROUP_NAME = "ZZ Demo — Costing Excluded"

/** The two accounts the demo is run from. Looked up by email, never hardcoded by id. */
const ADMIN_EMAIL = "arkadatax03@gmail.com"
const EMPLOYEE_EMAIL = "tggroup.itdept@gmail.com"
/** Scenery: real people, named on the canvas roster so each department recognises itself. */
const OWNER_EMAIL = "lesolvnow@gmail.com" // Maey Zausa, SALES HEAD — Deal Owner on B and C
const EXCLUDED_EMAIL = "tggroup.sales3@gmail.com" // Mary Grace Malazarte — in the excluded group

/**
 * Six Stages, Government-shaped but short enough to fit one screen.
 * `costing` is the Restricted one; `bid` is where the long window closes.
 */
const STAGES = [
  { key: "registered", name: "Registered", x: 0, y: 0 },
  { key: "technical", name: "Technical Review", x: 260, y: 0 },
  { key: "costing", name: "Costing", x: 520, y: 0 },
  { key: "bid", name: "Bid Submitted", x: 780, y: 0 },
  { key: "awarded", name: "Awarded", x: 1040, y: -90 },
  { key: "lost", name: "Closed Lost", x: 1040, y: 90, terminal: true },
]

const EDGES = [
  ["registered", "technical"],
  ["technical", "costing"],
  ["costing", "bid"],
  ["bid", "awarded"],
  ["bid", "lost"],
  ["costing", "technical"], // a loop back, so the flow is visibly a graph and not a list
]

function parseArgs(argv) {
  const args = { apply: false, teardown: false }
  for (const a of argv) {
    if (a === "--apply") args.apply = true
    else if (a === "--teardown") args.teardown = true
    else if (a === "--help" || a === "-h") args.help = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

async function employeeIdByEmail(client, email) {
  const { rows } = await client.query(
    "select id, name from employees where email = $1 and is_deleted is not true",
    [email],
  )
  if (rows.length === 0) throw new Error(`No employee on staging with email ${email}.`)
  return rows[0]
}

/**
 * Removes a previous run entirely. Children go first because the demo's SORs
 * carry visits and participant windows that reference the Stages being
 * dropped, and `on delete cascade` is not defined across every one of them.
 */
async function teardown(client) {
  const { rows: existing } = await client.query("select id from sale_types where name = $1", [SALE_TYPE])
  if (existing.length > 0) {
    const saleTypeIds = existing.map((r) => r.id)
    const { rows: opps } = await client.query(
      "select id from sales_opportunities where sale_type_id = any($1::uuid[])",
      [saleTypeIds],
    )
    const oppIds = opps.map((r) => r.id)
    if (oppIds.length > 0) {
      for (const table of [
        "sor_stage_participants",
        "sor_stage_visits",
        "sor_condition_status",
        "sor_stage_field_values",
        "sales_opportunity_members",
        "sales_opportunity_items",
        "sales_opportunity_logs",
      ]) {
        await client.query(`delete from ${table} where opportunity_id = any($1::uuid[])`, [oppIds])
      }
      // notifications.reference_id is text, not uuid — compare as text.
      await client.query("delete from notifications where reference_id = any($1::text[])", [oppIds])
      await client.query("delete from sales_opportunities where id = any($1::uuid[])", [oppIds])
    }

    const { rows: flows } = await client.query(
      "select id from sales_flows where sale_type_id = any($1::uuid[])",
      [saleTypeIds],
    )
    const flowIds = flows.map((r) => r.id)
    if (flowIds.length > 0) {
      const { rows: stages } = await client.query(
        "select id from flow_stages where flow_id = any($1::uuid[])",
        [flowIds],
      )
      const stageIds = stages.map((r) => r.id)
      if (stageIds.length > 0) {
        await client.query("delete from flow_stage_access where stage_id = any($1::uuid[])", [stageIds])
        await client.query("delete from stage_conditions where stage_id = any($1::uuid[])", [stageIds])
        await client.query("delete from flow_stage_actions where stage_id = any($1::uuid[])", [stageIds])
        await client.query("delete from flow_stage_fields where stage_id = any($1::uuid[])", [stageIds])
        await client.query("delete from flow_stage_follow_ups where stage_id = any($1::uuid[])", [stageIds])
      }
      await client.query("delete from flow_access_settings where flow_id = any($1::uuid[])", [flowIds])
      await client.query("delete from flow_form_fields where flow_id = any($1::uuid[])", [flowIds])
      await client.query("delete from flow_edges where flow_id = any($1::uuid[])", [flowIds])
      await client.query("update sales_flows set won_stage_id = null where id = any($1::uuid[])", [flowIds])
      await client.query("delete from flow_stages where flow_id = any($1::uuid[])", [flowIds])
      await client.query("delete from flow_snapshots where flow_id = any($1::uuid[])", [flowIds])
      await client.query("delete from sales_flows where id = any($1::uuid[])", [flowIds])
    }
    await client.query("delete from sale_types where id = any($1::uuid[])", [saleTypeIds])
  }

  const { rows: groups } = await client.query("select id from employee_groups where name = $1", [GROUP_NAME])
  if (groups.length > 0) {
    const groupIds = groups.map((r) => r.id)
    await client.query("delete from employee_group_members where group_id = any($1::uuid[])", [groupIds])
    await client.query("delete from employee_group_teams where group_id = any($1::uuid[])", [groupIds])
    await client.query("delete from employee_groups where id = any($1::uuid[])", [groupIds])
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log("node scripts/seed-stage-access-demo.mjs [--teardown] [--apply]")
    return
  }

  const env = loadDotEnvLocal(repoRoot)
  const url = process.env.STAGING_DB_URL || env.STAGING_DB_URL
  if (!url) throw new Error("STAGING_DB_URL is not set — put it in .env.local or the environment.")

  const client = new pg.Client({ connectionString: url })
  await client.connect()

  try {
    await client.query("begin")
    // `sor_guard_stage_move` refuses a Stage move unless the caller reads
    // 'full' on the SOR. This connection carries no JWT, so it would refuse
    // every move below; the guard exempts service_role, and auth.role()
    // reads this setting.
    await client.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")

    await teardown(client)

    // --teardown stops here: the demo's Sale Type, flow, group and SORs are
    // gone and nothing is rebuilt. Still gated on --apply like every other
    // run, so `--teardown` alone reports what it would remove and rolls back.
    if (args.teardown) {
      if (args.apply) {
        await client.query("commit")
        console.log(`Removed "${SALE_TYPE}" and "${GROUP_NAME}" from staging.`)
      } else {
        await client.query("rollback")
        console.log(`Would remove "${SALE_TYPE}" and "${GROUP_NAME}". Re-run with --apply to do it.`)
      }
      return
    }

    const admin = await employeeIdByEmail(client, ADMIN_EMAIL)
    const employee = await employeeIdByEmail(client, EMPLOYEE_EMAIL)
    const owner = await employeeIdByEmail(client, OWNER_EMAIL)
    const excluded = await employeeIdByEmail(client, EXCLUDED_EMAIL)

    // ── The excluded Employee Group ───────────────────────────────────────
    // Holds someone other than the demo's employee account on purpose: the
    // Stage shuts that account out by ROLE, so a group holding a different
    // person makes the Access tab name two separate shut-out sources.
    const { rows: groupRows } = await client.query(
      "insert into employee_groups (name, description, created_by) values ($1, $2, $3) returning id",
      [GROUP_NAME, "Demo fixture — shut out of the Costing Stage.", admin.id],
    )
    const groupId = groupRows[0].id
    await client.query(
      "insert into employee_group_members (group_id, employee_id, added_by) values ($1, $2, $3)",
      [groupId, excluded.id, admin.id],
    )

    // ── Sale Type + Sales Flow ────────────────────────────────────────────
    const { rows: saleTypeRows } = await client.query(
      "insert into sale_types (name, created_by) values ($1, $2) returning id",
      [SALE_TYPE, admin.id],
    )
    const saleTypeId = saleTypeRows[0].id

    const { rows: flowRows } = await client.query(
      "insert into sales_flows (sale_type_id, state) values ($1, 'draft') returning id",
      [saleTypeId],
    )
    const flowId = flowRows[0].id

    const stageId = {}
    for (const [i, s] of STAGES.entries()) {
      const { rows } = await client.query(
        `insert into flow_stages (flow_id, name, sort_order, is_terminal, pos_x, pos_y)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [flowId, s.name, i * 10, !!s.terminal, s.x, s.y],
      )
      stageId[s.key] = rows[0].id
    }

    for (const [from, to] of EDGES) {
      await client.query(
        "insert into flow_edges (flow_id, from_stage_id, to_stage_id) values ($1, $2, $3)",
        [flowId, stageId[from], stageId[to]],
      )
    }

    await client.query("update sales_flows set won_stage_id = $1 where id = $2", [stageId.awarded, flowId])

    // ── Who always sees, and who may open a Journey ───────────────────────
    // `always_sees` names Purchasing as scenery the room recognises; it must
    // NOT name the demo's employee account, or his participant windows would
    // be irrelevant. `journey_viewers` DOES name his team, so a called-in
    // outsider can open the Journey and watch a Restricted Stage render as
    // one contentless line.
    await client.query(
      "insert into flow_access_settings (flow_id, always_sees, journey_viewers) values ($1, $2::jsonb, $3::jsonb)",
      [
        flowId,
        JSON.stringify([{ type: "team", team: "PURCHASING" }]),
        JSON.stringify([{ type: "team", team: "IT" }]),
      ],
    )

    // ── The Restricted Stage ──────────────────────────────────────────────
    await client.query(
      "insert into flow_stage_access (stage_id, shut_out_roles, excluded_group_ids) values ($1, $2, $3)",
      [stageId.costing, ["deal_owner"], [groupId]],
    )

    // ── Stage Conditions — the two call-ins ───────────────────────────────
    // Two different window rules on one person, so the Access tab shows the
    // two lines `sor_stage_participants` actually keeps for two call-ins.
    const { rows: condLong } = await client.query(
      `insert into stage_conditions (stage_id, kind, label, is_required, sort_order, config)
       values ($1, 'assignment', $2, true, 0, $3::jsonb) returning id`,
      [
        stageId.registered,
        "Assign the Technical Reviewer",
        JSON.stringify({
          who: [{ type: "employee", id: employee.id }],
          access: { until: "later_stage_left", stageId: stageId.bid },
        }),
      ],
    )
    const { rows: condShort } = await client.query(
      `insert into stage_conditions (stage_id, kind, label, is_required, sort_order, config)
       values ($1, 'assignment', $2, true, 0, $3::jsonb) returning id`,
      [
        stageId.technical,
        "Assign the Warehouse Checker",
        JSON.stringify({
          who: [{ type: "employee", id: employee.id }],
          access: { until: "stage_left" },
        }),
      ],
    )
    await client.query(
      `insert into stage_conditions (stage_id, kind, label, is_required, sort_order, config)
       values ($1, 'tickbox', $2, true, 1, '{}'::jsonb)`,
      [stageId.costing, "Costing sheet approved"],
    )

    // ── The three SORs ────────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10)

    async function registerSor({ ref, client_name, project_title, dealOwnerId, stage, status }) {
      const { rows } = await client.query(
        `insert into sales_opportunities
           (registration_date, registered_at, registered_by, lead_source, client_name,
            contact_person, project_title, project_type, expected_value, expected_award_date,
            deal_owner_id, sales_director_id, status, sales_reference, sale_type_id, flow_stage_id)
         values ($1, now(), $2, 'LGU', $3, 'Demo Contact', $4, 'SSP', 1250000, $5,
                 $6, $7, $8, $9, $10, $11)
         returning id`,
        [
          today,
          admin.id,
          client_name,
          project_title,
          today,
          dealOwnerId,
          owner.id,
          status,
          ref,
          saleTypeId,
          stageId[stage],
        ],
      )
      return rows[0].id
    }

    // A — the employee is Deal Owner. Full access, one row in his register,
    // and the Restricted Stage will shut him out of his own deal.
    const sorA = await registerSor({
      ref: "S99001",
      client_name: "Demo City LGU",
      project_title: "Demo A — Deal Team view",
      dealOwnerId: employee.id,
      stage: "technical",
      status: "PROPOSAL_SUBMITTED",
    })

    // B — the employee is nowhere on the Deal Team. Parked on the entry
    // Stage with its Assignment condition unanswered, so the call-in is made
    // live, through the real path, in front of the room.
    const sorB = await registerSor({
      ref: "S99002",
      client_name: "Demo Provincial Office",
      project_title: "Demo B — called in live",
      dealOwnerId: owner.id,
      stage: "registered",
      status: "PROPOSAL_SUBMITTED",
    })

    // C — pre-aged. The employee was called in at Technical Review on a
    // "Only this Stage" window; the deal has since moved twice, so the
    // trigger has closed the window and his access level reads 'locked'.
    // Reaching this state live would cost the room five minutes.
    const sorC = await registerSor({
      ref: "S99003",
      client_name: "Demo Regional Hospital",
      project_title: "Demo C — window already closed",
      dealOwnerId: owner.id,
      stage: "registered",
      status: "PROPOSAL_SUBMITTED",
    })

    await client.query("update sales_opportunities set flow_stage_id = $1 where id = $2", [
      stageId.technical,
      sorC,
    ])
    const { rows: visitRows } = await client.query(
      `select id from sor_stage_visits
       where opportunity_id = $1 and flow_stage_id = $2
       order by sequence desc limit 1`,
      [sorC, stageId.technical],
    )
    if (visitRows.length === 0) throw new Error("Expected record_stage_visit to have written a visit for Demo C.")

    await client.query(
      `insert into sor_stage_participants
         (opportunity_id, employee_id, source, source_id, opened_visit_id, until_rule)
       values ($1, $2, 'assignment', $3, $4, 'stage_left')`,
      [sorC, employee.id, condShort[0].id, visitRows[0].id],
    )
    await client.query(
      "insert into sales_opportunity_members (opportunity_id, employee_id, added_by) values ($1, $2, $3)",
      [sorC, employee.id, admin.id],
    )
    // Two moves: the first closes the window (the trigger fires on leaving
    // the Stage the window names), the second proves it stays closed.
    await client.query("update sales_opportunities set flow_stage_id = $1 where id = $2", [stageId.costing, sorC])
    await client.query("update sales_opportunities set flow_stage_id = $1 where id = $2", [stageId.bid, sorC])

    // ── Verify, as the two accounts, before committing ────────────────────
    const checks = []
    for (const [label, email, expectA, expectB, expectC] of [
      ["admin", ADMIN_EMAIL, "full", "full", "full"],
      ["employee", EMPLOYEE_EMAIL, "full", "none", "locked"],
    ]) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ role: "authenticated", email }),
      ])
      await client.query("set local role authenticated")
      const { rows } = await client.query(
        `select public.sor_access_level($1) a, public.sor_access_level($2) b, public.sor_access_level($3) c,
                (select count(*) from sales_opportunities
                  where is_deleted is not true and is_scratch = false and is_retail = false) register`,
        [sorA, sorB, sorC],
      )
      await client.query("reset role")
      await client.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)")
      const got = rows[0]
      checks.push({ label, ...got, expect: [expectA, expectB, expectC].join("/") })
    }

    console.log(`Sale Type   ${SALE_TYPE}  (${saleTypeId})`)
    console.log(`Sales Flow  ${flowId}  draft, 6 Stages, Won = Awarded`)
    console.log(`Restricted  Costing — shut out: deal_owner, group "${GROUP_NAME}" (${excluded.name})`)
    console.log(`Call-ins    Registered → ${employee.name}, through Bid Submitted`)
    console.log(`            Technical Review → ${employee.name}, only this Stage`)
    console.log(`SORs        S99001 / Demo A ${sorA}  (${employee.name} is Deal Owner, at Technical Review)`)
    console.log(`            S99002 / Demo B ${sorB}  (at Registered, call-in not yet made)`)
    console.log(`            S99003 / Demo C ${sorC}  (at Bid Submitted, window already closed)`)
    console.log("")
    console.log("Access level per account (A/B/C) and register row count:")
    for (const c of checks) {
      const got = [c.a, c.b, c.c].join("/")
      const ok = got === c.expect ? "ok " : "!! "
      console.log(`  ${ok}${c.label.padEnd(9)} ${got.padEnd(22)} expected ${c.expect.padEnd(22)} register ${c.register}`)
    }

    const failed = checks.filter((c) => [c.a, c.b, c.c].join("/") !== c.expect)
    if (failed.length > 0) throw new Error("Access levels are not what the demo needs — nothing committed.")

    if (args.apply) {
      await client.query("commit")
      console.log("\nCommitted.")
    } else {
      await client.query("rollback")
      console.log("\nRehearsal only — rolled back. Re-run with --apply to keep it.")
    }
  } catch (err) {
    await client.query("rollback").catch(() => {})
    throw err
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
