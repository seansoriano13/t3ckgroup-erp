#!/usr/bin/env node
/**
 * Seeds (or refreshes) the mock employee cast on STAGING — one sign-in per
 * role shape the app discriminates on, for manual and AI-driven testing.
 *
 * Credentials live in docs/mock-employees.md. They are staging-only test
 * accounts; this script refuses to run against anything but STAGING_DB_URL.
 * Idempotent: re-running resets each password and flag to what's below.
 *
 *   node scripts/seed-mock-employees.mjs
 */
import pg from "pg"
import path from "path"
import { fileURLToPath } from "url"
import { loadDotEnvLocal } from "./lib/seedShared.mjs"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")

export const MOCK_PASSWORD = "MockStaging#2026"
export const MOCK_DOMAIN = "mock.t3ck.test"

export const MOCK = {
  "super-admin": { name: "Mock Super Admin", department: "SUPER ADMIN", role: "SYSTEM ADMINISTRATOR", is_super_admin: true },
  "sales-head": { name: "Mock Sales Head", department: "SALES", role: "SALES DIRECTOR", is_head: true, has_sales_flow: true },
  "sales-subhead": { name: "Mock Sales Sub Head", department: "SALES", sub_department: "NGO", role: "NGO TEAM LEAD", is_head: true, has_sales_flow: true },
  "sales-exec": { name: "Mock Sales Executive", department: "SALES", sub_department: "NGO", role: "SALES EXECUTIVE", has_sales_flow: true },
  "sales-exec-2": { name: "Mock Sales Executive Two", department: "SALES", sub_department: "GOV", role: "SALES EXECUTIVE", has_sales_flow: true },
  "hr": { name: "Mock HR Officer", department: "ADMIN", sub_department: "HR", role: "HR OFFICER", is_hr: true },
  "leave-manager": { name: "Mock Leave Manager", department: "ADMIN", sub_department: "HR", role: "HR ASSISTANT", can_manage_leaves: true },
  "admin-head": { name: "Mock Admin Head", department: "ADMIN", sub_department: "ADMIN", role: "ADMIN MANAGER", is_head: true, has_task_flow: true },
  "finance": { name: "Mock Finance Staff", department: "ADMIN", sub_department: "FINANCE", role: "ACCOUNTING STAFF", has_task_flow: true },
  "ops-head": { name: "Mock Operations Head", department: "OPERATIONS", role: "OPERATIONS MANAGER", is_head: true, has_task_flow: true },
  "purchaser": { name: "Mock Purchaser", department: "OPERATIONS", sub_department: "PURCHASING", role: "PURCHASER", has_purchasing_flow: true, has_task_flow: true },
  "logistics": { name: "Mock Logistics Staff", department: "OPERATIONS", sub_department: "LOGISTICS", role: "LOGISTICS ASSISTANT", has_task_flow: true },
  "technical": { name: "Mock Technical Staff", department: "OPERATIONS", sub_department: "TECHNICAL", role: "TECHNICIAN", has_task_flow: true },
  "flow-editor": { name: "Mock Flow Editor", department: "OPERATIONS", sub_department: "IT", role: "IT STAFF", can_edit_sales_flows: true },
  "plain": { name: "Mock Plain Employee", department: "OPERATIONS", sub_department: "WAREHOUSE", role: "WAREHOUSE STAFF" },
}

const FLAGS = ["is_head", "is_hr", "is_super_admin", "can_manage_leaves", "can_edit_sales_flows", "has_sales_flow", "has_task_flow", "has_purchasing_flow"]

async function main() {
  const url = loadDotEnvLocal(repoRoot).STAGING_DB_URL ?? process.env.STAGING_DB_URL
  if (!url) throw new Error("STAGING_DB_URL is not set (.env.local or the environment).")
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  try {
    for (const [key, spec] of Object.entries(MOCK)) {
      const email = `${key}@${MOCK_DOMAIN}`
      await c.query("begin")
      const existing = await c.query("select id from auth.users where email = $1", [email])
      let id = existing.rows[0]?.id
      if (id) {
        await c.query(
          "update auth.users set encrypted_password = crypt($2, gen_salt('bf')), email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now() where id = $1",
          [id, MOCK_PASSWORD],
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
            [email, MOCK_PASSWORD],
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
      await c.query("commit")
      console.log(`ok  ${email}`)
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
