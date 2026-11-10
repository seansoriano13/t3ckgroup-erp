#!/usr/bin/env node
/**
 * Seeds (or refreshes) the mock employee cast on STAGING (or the local stack
 * with --local) — one sign-in per
 * role shape the app discriminates on, for manual and AI-driven testing.
 *
 * Credentials live in docs/mock-employees.md. They are staging-only test
 * accounts; this script runs only against STAGING_DB_URL or, with --local,
 * LOCAL_DB_URL / the default `supabase start` database.
 * Idempotent: re-running resets each password and flag to what's below.
 *
 *   node scripts/seed-mock-employees.mjs [--local]
 */
import pg from "pg"
import path from "path"
import { fileURLToPath } from "url"
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

// Short and easy to type: dani@staging / staging, dani@local / local.
export const MOCK_PASSWORD = "staging"
export const LOCAL_MOCK_PASSWORD = "local"
export const MOCK_DOMAIN = "staging"
export const LOCAL_MOCK_DOMAIN = "local"
// The emails before the rename; such an account is renamed in place, so its work stays with it.
const OLD_DOMAIN = { staging: "mock.t3ck.test", local: "local" }

export const MOCK = {
  "super-admin": { name: "Mock Super Admin", department: "SUPER ADMIN", role: "SYSTEM ADMINISTRATOR", is_super_admin: true },
  "sales-head": { name: "Mock Sales Head", department: "SALES", role: "SALES DIRECTOR", is_head: true, has_sales_flow: true, has_retail_access: true },
  "sales-subhead": { name: "Mock Sales Sub Head", department: "SALES", sub_department: "NGO", role: "NGO TEAM LEAD", is_head: true, has_sales_flow: true, has_retail_access: true },
  "sales-exec": { name: "Mock Sales Executive", department: "SALES", sub_department: "NGO", role: "SALES EXECUTIVE", has_sales_flow: true, has_retail_access: true },
  "sales-exec-2": { name: "Mock Sales Executive Two", department: "SALES", sub_department: "GOV", role: "SALES EXECUTIVE", has_sales_flow: true, has_retail_access: true },
  "hr": { name: "Mock HR Officer", department: "ADMIN", sub_department: "HR", role: "HR OFFICER", is_hr: true },
  "leave-manager": { name: "Mock Leave Manager", department: "ADMIN", sub_department: "HR", role: "HR ASSISTANT", can_manage_leaves: true },
  "admin-head": { name: "Mock Admin Head", department: "ADMIN", sub_department: "ADMIN", role: "ADMIN MANAGER", is_head: true, has_task_flow: true },
  "finance": { name: "Mock Finance Staff", department: "ADMIN", sub_department: "FINANCE", role: "ACCOUNTING STAFF", has_task_flow: true, has_finance_flow: true },
  "ops-head": { name: "Mock Operations Head", department: "OPERATIONS", role: "OPERATIONS MANAGER", is_head: true, has_task_flow: true },
  "purchaser": { name: "Mock Purchaser", department: "OPERATIONS", sub_department: "PURCHASING", role: "PURCHASER", has_purchasing_flow: true, has_task_flow: true },
  "logistics": { name: "Mock Logistics Staff", department: "OPERATIONS", sub_department: "LOGISTICS", role: "LOGISTICS ASSISTANT", has_task_flow: true },
  "technical": { name: "Mock Technical Staff", department: "OPERATIONS", sub_department: "TECHNICAL", role: "TECHNICIAN", has_task_flow: true },
  "flow-editor": { name: "Mock Flow Editor", department: "OPERATIONS", sub_department: "IT", role: "IT STAFF", can_edit_sales_flows: true },
  "plain": { name: "Mock Plain Employee", department: "OPERATIONS", sub_department: "WAREHOUSE", role: "WAREHOUSE STAFF" },
  // Purchasing stories (docs/stories/purchasing): a second purchaser who is not on
  // the request, and an approver for the lists nobody else sits on.
  "purchaser-2": { name: "Mock Purchaser Two", department: "OPERATIONS", sub_department: "PURCHASING", role: "PURCHASER", has_purchasing_flow: true, has_task_flow: true },
  "approver": { name: "Mock Approver", department: "ADMIN", sub_department: "ADMIN", role: "GENERAL MANAGER", is_head: true, has_task_flow: true },
}

// Each mock role signs in as the real person who does that job (dani@staging, dani@local), and the
// name ends in "(staging)" or "(local)" so a mock screen is never mistaken for the real one.
export const LOGINS = {
  "super-admin": "101",
  "sales-head": "maey",
  "sales-subhead": "grace",
  "sales-exec": "dani",
  "sales-exec-2": "aldrin",
  "hr": "geane",
  "leave-manager": "ysabelle",
  "admin-head": "jen",
  "finance": "jelai",
  "ops-head": "gracean",
  "purchaser": "ayla",
  "logistics": "alvin",
  "technical": "oliver",
  "flow-editor": "sean",
  "plain": "jade",
  "purchaser-2": "micko",
  "approver": "201",
}
const mockName = (login, where) => `${/^\d+$/.test(login) ? login : login[0].toUpperCase() + login.slice(1)} (${where})`

const FLAGS = ["is_head", "is_hr", "is_super_admin", "can_manage_leaves", "can_edit_sales_flows", "has_sales_flow", "has_task_flow", "has_purchasing_flow", "has_finance_flow", "has_retail_access"]

// Local stack only: put the cast on the Transmittal staff lists (#251) and give
// the two Check by members the paper call signs. Staging's lists stay real config.
const LOCAL_LISTS = {
  transmittal_warehouse: ["plain"],
  transmittal_technical: ["technical"],
  transmittal_logistics: ["logistics"],
  transmittal_check_by: ["ops-head", "admin-head"],
  s1_approved: ["admin-head"],
  s3_approved: ["admin-head"],
  s7_received: ["ops-head"],
  s7_noted: ["sales-head"],
  s7_checked: ["approver"],
  s7_approved: ["approver"],
}
// Local stack only: the Costing Matrix lists (Super Admin stays off them, on purpose).
const LOCAL_COSTING_LISTS = {
  final_acquire: ["approver"],
  evaluation: ["ops-head"],
}
const LOCAL_CALL_SIGNS = { "ops-head": "1001", "admin-head": "102" }

async function main() {
  const env = loadDotEnvLocal(repoRoot)
  const local = process.argv.includes("--local")
  const url = local
    ? process.env.LOCAL_DB_URL || env.LOCAL_DB_URL || DEFAULT_LOCAL_DB_URL
    : env.STAGING_DB_URL ?? process.env.STAGING_DB_URL
  if (!url) throw new Error("STAGING_DB_URL is not set (.env.local or the environment).")
  const password = local ? LOCAL_MOCK_PASSWORD : MOCK_PASSWORD
  const domain = local ? LOCAL_MOCK_DOMAIN : MOCK_DOMAIN
  console.log(local ? "Target: LOCAL stack" : "Target: STAGING")
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    for (const [key, spec] of Object.entries(MOCK)) {
      const email = `${LOGINS[key]}@${domain}`
      const name = mockName(LOGINS[key], domain)
      await c.query("begin")
      // An account from before the rename (purchaser@mock.t3ck.test, purchaser@local) keeps its id, and so its work, under the new email.
      const old = `${key}@${OLD_DOMAIN[domain]}`
      const taken = await c.query("select 1 from auth.users where email = $1", [email])
      if (!taken.rows.length) {
        await c.query("update auth.users set email = $2 where email = $1", [old, email])
        await c.query("update auth.identities set identity_data = identity_data || jsonb_build_object('email', $2::text) where identity_data->>'email' = $1", [old, email])
      }
      const existing = await c.query("select id from auth.users where email = $1", [email])
      let id = existing.rows[0]?.id
      if (id) {
        await c.query(
          "update auth.users set encrypted_password = crypt($2, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1",
          [id, password],
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
            [email, password],
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
        [id, email, name, spec.department, spec.sub_department ?? null, spec.role, ...flags],
      )
      await c.query("commit")
      console.log(`ok  ${email}`)
    }
    if (local) {
      for (const [key, sign] of Object.entries(LOCAL_CALL_SIGNS)) {
        // A call sign is unique; another local row (a staging mock copied down) may hold it already.
        await c.query("update public.employees set call_sign = null where call_sign = $2 and email <> $1", [`${LOGINS[key]}@${domain}`, sign])
        await c.query("update public.employees set call_sign = $2 where email = $1", [`${LOGINS[key]}@${domain}`, sign])
      }
      for (const [list, keys] of Object.entries(LOCAL_LISTS)) {
        for (const key of keys) {
          await c.query(
            `insert into public.ipas_signer_lists (list_key, employee_id)
             select $1, id from public.employees where email = $2 on conflict (list_key, employee_id) do nothing`,
            [list, `${LOGINS[key]}@${domain}`],
          )
        }
        console.log(`ok  ${list}: ${keys.join(", ")}`)
      }
      for (const [list, keys] of Object.entries(LOCAL_COSTING_LISTS)) {
        for (const key of keys) {
          await c.query(
            `insert into public.costing_signer_lists (list_key, employee_id)
             select $1, id from public.employees where email = $2 on conflict (list_key, employee_id) do nothing`,
            [list, `${LOGINS[key]}@${domain}`],
          )
        }
        console.log(`ok  ${list}: ${keys.join(", ")}`)
      }
    }
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
