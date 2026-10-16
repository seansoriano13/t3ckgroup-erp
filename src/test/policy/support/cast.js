/**
 * The seeded cast.
 *
 * Every policy in this application resolves identity through helpers shaped
 * like `SELECT id FROM employees WHERE email = auth.jwt() ->> 'email'` — by the
 * **email claim on the token**, not by `auth.uid()`. A fixture that creates an
 * employee row without a matching auth user, or with a mismatched email, makes
 * `get_employee_id()` return null; every policy then silently denies and the
 * whole matrix passes for entirely the wrong reason.
 *
 * That is the sharpest way this tier can lie, so the cast is built auth-user
 * first, the employee row is created with the same id and the same email, and
 * 01-fixture.test.js proves the link resolves before anything else runs.
 */
import { createClient } from "@supabase/supabase-js"
import { API_URL, ANON_KEY, serviceClient, sql } from "./stack.js"
import { purgeFixtureIpas } from "./ipas.js"
import { purgeFixtureCosting } from "./costing.js"
import { purgeFixtureTransmittals } from "./transmittals.js"

/** Shared by every cast member. Local stack only; nothing here is a secret. */
export const CAST_PASSWORD = "policy-tier-fixture-password"

/** Every fixture email ends with this, which is how teardown finds them. */
export const FIXTURE_DOMAIN = "policy.fixture"

/**
 * Cast keys are camelCase; fixture emails are not, and that is deliberate.
 *
 * GoTrue lowercases an address on sign-up, but `get_employee_id()` compares
 * `auth.jwt() ->> 'email'` against `employees.email` with plain `=`, which is
 * case-sensitive. An employee row stored as `Deal.Owner@…` therefore resolves
 * to null for a token carrying `deal.owner@…`, and every policy denies them
 * silently. Seeding mixed-case emails here would reproduce that against the
 * whole cast and drown the real assertions; 02 covers the behaviour on purpose
 * instead.
 */
const slug = (key) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const email = (key) => `${slug(key)}@${FIXTURE_DOMAIN}`

/**
 * Nineteen identities, covering every distinct shape the policies discriminate on.
 * `deleted` is soft-deleted rather than absent, because `is_deleted` is a
 * column the application filters on and a policy mostly does not.
 */
export const CAST = {
    ordinary: {
        name: "Ordinary Employee",
        department: "SALES",
        sub_department: "NGO",
        role: "SALES EXECUTIVE",
    },
    outsider: {
        name: "Other Department Employee",
        department: "OPERATIONS",
        sub_department: "LOGISTICS",
        role: "OPERATIONS ASSISTANT",
    },
    dealOwner: {
        name: "Deal Owner",
        department: "SALES",
        sub_department: "NGO",
        role: "SENIOR SALES EXECUTIVE",
        has_sales_flow: true,
    },
    support: {
        name: "Supporting Salesperson",
        department: "SALES",
        sub_department: "NGO",
        role: "SALES EXECUTIVE",
        has_sales_flow: true,
    },
    closingSales: {
        // #293 (ADR 0021): the Closing Salesperson joins the Deal Team via
        // closing_sales_id, distinct from Deal Owner/Support so a pass here
        // can only be that column doing the work.
        name: "Closing Salesperson",
        department: "SALES",
        sub_department: "NGO",
        role: "SALES EXECUTIVE",
        has_sales_flow: true,
    },
    head: {
        // No sub_department: the "master head" shape the nav and the badge
        // counts treat as owning a whole department.
        name: "Department Head",
        department: "SALES",
        sub_department: null,
        role: "SALES DIRECTOR",
        is_head: true,
        has_sales_flow: true,
    },
    subHead: {
        name: "Sub Department Head",
        department: "SALES",
        sub_department: "NGO",
        role: "NGO TEAM LEAD",
        is_head: true,
    },
    hr: {
        name: "HR Officer",
        department: "HUMAN RESOURCES",
        sub_department: null,
        role: "HR OFFICER",
        is_hr: true,
    },
    leaveManager: {
        // The narrow capability on its own — deliberately not is_hr, because
        // the whole point of that flag existing is that it is granted alone.
        name: "Leave Manager",
        department: "HUMAN RESOURCES",
        sub_department: null,
        role: "HR ASSISTANT",
        can_manage_leaves: true,
    },
    flowEditor: {
        // The Flow editor capability on its own — deliberately not
        // superAdmin and not has_sales_flow, so a pass here can only be the
        // flag doing the work (#291).
        name: "Flow Editor",
        department: "OPERATIONS",
        sub_department: null,
        role: "OPERATIONS MANAGER",
        can_edit_sales_flows: true,
    },
    stageParticipant: {
        // #295 (ADR 0021): called into a single Stage's work by an action or
        // Assignment condition — no Deal Team role, no Always-sees grant, so
        // any access this identity gets can only come from an open
        // sor_stage_participants window.
        name: "Stage Participant",
        department: "OPERATIONS",
        sub_department: "PROCUREMENT",
        role: "PURCHASER",
    },
    finance: {
        // Finance access on its own (#242) — deliberately not has_purchasing_flow
        // and not a Super Admin, so a pass on an IPAS read can only be the
        // flag doing the work.
        name: "Finance Officer",
        department: "FINANCE",
        sub_department: null,
        role: "ACCOUNTING OFFICER",
        has_finance_flow: true,
    },
    ipasSigner: {
        // A plain employee who is put on an IPAS sign-off list by the test
        // that needs it (#242): no flag of any kind, so reading an IPAS can
        // only be list membership doing the work.
        name: "IPAS Signer",
        department: "ADMINISTRATION",
        sub_department: null,
        role: "GENERAL MANAGER",
    },
    // Transmittal staff (#252): plain employees, no flags. Each is put on one
    // Transmittal staff list by the test that needs it, so reading a Transmittal
    // can only be list membership doing the work.
    warehouse: {
        name: "Warehouse Staff",
        department: "OPERATIONS",
        sub_department: "WAREHOUSE",
        role: "WAREHOUSE STAFF",
    },
    technical: {
        name: "TCA Technical",
        department: "OPERATIONS",
        sub_department: "TECHNICAL",
        role: "TECHNICAL STAFF",
    },
    logistics: {
        name: "Logistics Staff",
        department: "OPERATIONS",
        sub_department: "LOGISTICS",
        role: "LOGISTICS STAFF",
    },
    checkByTwo: {
        name: "Check By Second Signer",
        department: "ADMINISTRATION",
        sub_department: null,
        role: "GENERAL MANAGER",
    },
    superAdmin: {
        name: "Super Admin",
        department: "ADMINISTRATION",
        sub_department: null,
        role: "SYSTEM ADMINISTRATOR",
        is_super_admin: true,
    },
    deleted: {
        name: "Soft Deleted Employee",
        department: "SALES",
        sub_department: "NGO",
        role: "FORMER STAFF",
        is_deleted: true,
        employment_status: "Resigned",
    },
}

export const CAST_KEYS = Object.keys(CAST)

/**
 * Maps cast key to the employee/auth uuid.
 *
 * globalSetup runs in its own process, so the ids it creates cannot simply be
 * handed to the workers. Each worker resolves them back out of the database by
 * email instead — which has the side benefit that a missing row surfaces here,
 * as "the cast was not seeded", rather than as a uuid of `undefined` several
 * frames deeper.
 */
export const ids = {}

let loading = null

export function ensureCastLoaded() {
    if (!loading) {
        loading = (async () => {
            const { data, error } = await serviceClient()
                .from("employees")
                .select("id, email")
                .like("email", `%@${FIXTURE_DOMAIN}`)
            if (error) throw new Error(`Loading the cast: ${error.message}`)

            const bySlug = Object.fromEntries(CAST_KEYS.map((k) => [slug(k), k]))
            for (const row of data) {
                const key = bySlug[row.email.split("@")[0]]
                if (key) ids[key] = row.id
            }

            const missing = CAST_KEYS.filter((k) => !ids[k])
            if (missing.length) {
                throw new Error(
                    `The cast is not seeded — missing: ${missing.join(", ")}.\n` +
                        `globalSetup should have created it; run \`pnpm test:db\`.`,
                )
            }
            return ids
        })()
    }
    return loading
}

function employeeRow(key, id) {
    const spec = CAST[key]
    return {
        id,
        email: email(key),
        name: spec.name,
        department: spec.department,
        sub_department: spec.sub_department ?? null,
        role: spec.role,
        employment_status: spec.employment_status ?? "Regular",
        is_head: spec.is_head ?? false,
        is_hr: spec.is_hr ?? false,
        is_super_admin: spec.is_super_admin ?? false,
        can_manage_leaves: spec.can_manage_leaves ?? false,
        can_edit_sales_flows: spec.can_edit_sales_flows ?? false,
        has_sales_flow: spec.has_sales_flow ?? false,
        has_task_flow: spec.has_task_flow ?? false,
        has_purchasing_flow: spec.has_purchasing_flow ?? false,
        has_finance_flow: spec.has_finance_flow ?? false,
        has_retail_access: spec.has_retail_access ?? false,
        call_sign: spec.call_sign ?? null,
        is_deleted: spec.is_deleted ?? false,
        offset_hours_balance: 0,
        sil_hours_balance: 0,
    }
}

/**
 * Removes every trace of a previous run. Runs before seeding rather than after
 * the suite, so a crashed run leaves a database the next run can still use.
 */
export async function teardownCast() {
    const svc = serviceClient()

    // IPAS history can't be deleted by anyone, so IPAS go by the one route
    // that switches the triggers off (support/ipas.js), before their employees.
    // Transmittals and Packing Lists hold IPAS, SORs and employees, so they go first.
    await purgeFixtureTransmittals(`%@${FIXTURE_DOMAIN}`)
    // Costing history is append-only too (support/costing.js).
    await purgeFixtureCosting(`%@${FIXTURE_DOMAIN}`)
    await purgeFixtureIpas(`%@${FIXTURE_DOMAIN}`)

    // Rows this tier creates reference employees, so they go first. Each entry
    // names the column that points back at an employee; the order is
    // dependency order, children before parents.
    const OWNED_BY = [
        ["notifications", "sender_id"],
        ["notifications", "recipient_id"],
        ["system_audit_logs", "author_id"],
        ["committee_task_members", "employee_id"],
        ["committee_tasks", "created_by"],
        ["tasks", "logged_by"],
        ["overtime_requests", "employee_id"],
        ["offset_leaves", "employee_id"],
        ["sil_leaves", "employee_id"],
        // Notes go with their report.
        ["bug_report_notes", "author_id"],
        ["bug_reports", "reporter_id"],
        // Members, items and messages go with their request.
        ["purchase_requests", "created_by"],
        // Stage participants can sit on an SOR the fixture didn't make.
        ["sor_stage_participants", "employee_id"],
        ["sales_opportunities", "registered_by"],
        ["sales_opportunities", "deal_owner_id"],
    ]
    for (const [table, column] of OWNED_BY) {
        await sql().query(
            `delete from public.${table}
              where ${column} in (select id from public.employees where email like $1)`,
            [`%@${FIXTURE_DOMAIN}`],
        )
    }
    await sql().query(`delete from public.employees where email like $1`, [
        `%@${FIXTURE_DOMAIN}`,
    ])

    // GoTrue owns auth.users; delete through its admin API rather than SQL.
    let page = 1
    for (;;) {
        const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw new Error(`Listing auth users failed: ${error.message}`)
        const mine = data.users.filter((u) => u.email?.endsWith(`@${FIXTURE_DOMAIN}`))
        for (const u of mine) await svc.auth.admin.deleteUser(u.id)
        if (data.users.length < 200) break
        page += 1
    }
}

/**
 * Reference data the tier's own fixtures depend on.
 *
 * `sales_opportunities.status` carries a foreign key to
 * `crm_pipeline_stages(code)`, and **no active migration seeds that table** —
 * the seed lives in an archived migration that the baseline replaced, and
 * local development fills it from a sanitized staging dump instead
 * (`supabase/config.toml` sets `db.seed.enabled = false`; AGENTS.md explains
 * why). A database built purely from `supabase/migrations/` therefore cannot
 * hold a single SOR.
 *
 * Rather than depend on a developer having run `pnpm db:seed:restore` — which
 * would make this tier pass or fail according to leftover state, the exact
 * thing resetting first is meant to prevent — it seeds the one stage its
 * fixtures use. Idempotent, so it is harmless on a database that already has
 * the real set.
 */
export async function seedReferenceData() {
    const { error } = await serviceClient()
        .from("crm_pipeline_stages")
        .upsert(
            {
                code: "LEAD",
                label: "Lead",
                sort_order: 10,
                is_default: true,
                is_system: true,
            },
            // `ignoreDuplicates` matters: a developer running this against a
            // stack restored from the staging dump already has the real stage
            // set, and overwriting their LEAD row's label or flags with these
            // placeholder values would quietly corrupt their environment. Seed
            // only what is missing.
            { onConflict: "code", ignoreDuplicates: true },
        )
    if (error) throw new Error(`Seeding pipeline stages: ${error.message}`)
}

/**
 * Creates an auth user then a matching employee row for every cast member.
 * Populates `ids`.
 */
export async function seedCast() {
    const svc = serviceClient()

    for (const key of CAST_KEYS) {
        const { data, error } = await svc.auth.admin.createUser({
            email: email(key),
            password: CAST_PASSWORD,
            email_confirm: true,
        })
        if (error) throw new Error(`Creating auth user ${key}: ${error.message}`)
        ids[key] = data.user.id
    }

    // Inserted with the service role: an ordinary caller could not create these,
    // and this is seeding rather than an assertion.
    const rows = CAST_KEYS.map((key) => employeeRow(key, ids[key]))
    const { error } = await svc.from("employees").insert(rows)
    if (error) throw new Error(`Seeding employees: ${error.message}`)

    return ids
}

const clients = new Map()

/**
 * An ordinary anon-key client holding `key`'s signed-in token — the same path
 * the browser takes. Cached, because signing in is a real network round trip.
 */
export async function clientFor(key) {
    if (clients.has(key)) return clients.get(key)

    const client = createClient(API_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error } = await client.auth.signInWithPassword({
        email: email(key),
        password: CAST_PASSWORD,
    })
    if (error) throw new Error(`Signing in as ${key}: ${error.message}`)

    clients.set(key, client)
    return client
}

/** A client with no session at all, for the "not signed in" row of the matrix. */
export function anonymousClient() {
    return createClient(API_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
    })
}

export { email as castEmail }
