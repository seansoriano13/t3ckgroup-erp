/**
 * Row builders for the tables under test.
 *
 * Every row is created with the service role, on purpose. These are the
 * *subject* of an assertion, not the assertion itself — a matrix that seeded
 * its own rows through the client being tested could only ever cover the rows
 * that client was already allowed to create, which is the opposite of what a
 * refusal test needs.
 *
 * Naming follows CONTEXT.md: an **SOR** (never "deal" or "opportunity"), sold
 * to a **Company** (never "client"). The column names are what they are.
 *
 * Rows carry a recognisable marker so teardown can find them even after a
 * crashed run.
 */
import { serviceClient } from "./stack.js"

export const MARKER = "[policy-tier]"

/**
 * An SOR. Left at LEAD because `sales_opportunities_require_sales_ref` refuses
 * an insert at any later stage without a Sales Reference — a gate worth not
 * fighting when the subject of the test is who may read the record.
 */
export async function makeSor({
    registeredBy,
    dealOwnerId = null,
    supportSales1Id = null,
    salesDirectorId = null,
    companyName = `${MARKER} Acme Rescue Supplies`,
} = {}) {
    const { data, error } = await serviceClient()
        .from("sales_opportunities")
        .insert({
            registered_by: registeredBy,
            deal_owner_id: dealOwnerId,
            support_sales_1_id: supportSales1Id,
            sales_director_id: salesDirectorId,
            lead_source: "REFERRAL",
            client_name: companyName,
            project_title: `${MARKER} Rope Rescue Equipment`,
            expected_value: 125000,
            status: "LEAD",
        })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding an SOR: ${error.message}`)
    return data.id
}

/** The field set a caller needs to register an SOR in somebody's name. */
export function sorPayload(registeredBy, companyName = `${MARKER} Self Registered`) {
    return {
        registered_by: registeredBy,
        lead_source: "REFERRAL",
        client_name: companyName,
        project_title: `${MARKER} Registration attempt`,
        expected_value: 1000,
        status: "LEAD",
    }
}

/** An individual task. `tasks` requires nothing but its own id. */
export async function makeTask({ loggedBy, reportedTo = null } = {}) {
    const { data, error } = await serviceClient()
        .from("tasks")
        .insert({
            logged_by: loggedBy,
            reported_to: reportedTo,
            task_description: `${MARKER} Prepare the quotation pack`,
            project_title: `${MARKER} Internal`,
        })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding a task: ${error.message}`)
    return data.id
}

/** A Group Task, optionally with one member. */
export async function makeGroupTask({ createdBy, memberId = null } = {}) {
    const { data, error } = await serviceClient()
        .from("committee_tasks")
        .insert({
            title: `${MARKER} Trade show stand`,
            description: `${MARKER} Seeded by the policy tier`,
            created_by: createdBy,
        })
        .select("id")
        .single()
    if (error) throw new Error(`Seeding a Group Task: ${error.message}`)

    let memberRowId = null
    if (memberId) {
        const member = await serviceClient()
            .from("committee_task_members")
            .insert({
                committee_task_id: data.id,
                employee_id: memberId,
                task_description: `${MARKER} Build the stand`,
            })
            .select("id")
            .single()
        if (member.error) throw new Error(`Seeding a member: ${member.error.message}`)
        memberRowId = member.data.id
    }

    return { taskId: data.id, memberRowId }
}
