import { describe, expect, it } from "vitest"
import { getColumn, getTable, resolveRelation, schema } from "./schema"

/**
 * The schema registry is the foundation every service test stands on: if it
 * misreads the SQL, every downstream test is checking the wrong database.
 * Expected values here are read off t3ckgroup.sql and supabase/migrations/*.sql
 * by hand, never derived from the parser.
 */
describe("schema registry", () => {
  it("reads columns, types and NOT NULL from the baseline dump", () => {
    const table = getTable("sales_opportunities")

    expect(table.columns.client_name).toMatchObject({ type: "text", notNull: true })
    expect(table.columns.expected_value).toMatchObject({ type: "number", notNull: true })
    expect(table.columns.is_deleted).toMatchObject({ type: "boolean", notNull: true })
    expect(table.columns.contact_person.notNull).toBe(false)
  })

  it("records the primary key, including non-id and composite keys", () => {
    expect(getTable("tasks").primaryKey).toEqual(["id"])
    expect(getTable("crm_lead_sources").primaryKey).toEqual(["value"])
    expect(getTable("chat_read_receipts").primaryKey).toEqual([
      "user_id",
      "entity_type",
      "entity_id",
    ])
  })

  it("infers the constraint name for an inline column-level REFERENCES", () => {
    // 0001_sales_opportunities.sql declares this FK inline
    // (`registered_by uuid not null references public.employees(id)`)
    // rather than as a named table-level constraint. Postgres would name it
    // this way itself, and the app's embedded selects assume that name.
    expect(
      schema.relationsByConstraint.sales_opportunities_registered_by_fkey,
    ).toMatchObject({ fromTable: "sales_opportunities", fromColumn: "registered_by", toTable: "employees" })
    expect(
      schema.relationsByConstraint.sales_opportunities_deal_owner_id_fkey,
    ).toMatchObject({ fromColumn: "deal_owner_id", toTable: "employees" })
  })

  it("parses an inline REFERENCES even when followed by ON DELETE", () => {
    // 0003_sales_opportunity_items.sql:
    // `opportunity_id uuid not null references public.sales_opportunities(id) on delete cascade`
    expect(
      schema.relationsByConstraint.sales_opportunity_items_opportunity_id_fkey,
    ).toMatchObject({ toTable: "sales_opportunities", toColumn: "id" })
  })

  it("indexes foreign keys by their constraint name so embeds can be resolved", () => {
    expect(schema.relationsByConstraint.tasks_logged_by_fk).toMatchObject({
      fromTable: "tasks",
      fromColumn: "logged_by",
      toTable: "employees",
      toColumn: "id",
    })
    expect(
      schema.relationsByConstraint.sales_opportunities_deal_owner_id_fkey,
    ).toMatchObject({ fromColumn: "deal_owner_id", toTable: "employees" })
  })

  it("picks up tables introduced by a migration, not just the dump", () => {
    const leadSources = getTable("crm_lead_sources")

    expect(leadSources).not.toBeNull()
    expect(leadSources.columns.is_active).toMatchObject({ type: "boolean", notNull: true })
    expect(leadSources.columns.is_active.default).toEqual({ kind: "const", value: true })
  })

  it("applies ALTER TABLE ADD COLUMN from later migrations", () => {
    // 0012_leave_attachments.sql adds this column; the dump predates it.
    expect(getColumn("offset_leaves", "attachments")).toMatchObject({ type: "json" })
    expect(getColumn("overtime_requests", "reason")).toMatchObject({ type: "text" })
  })

  it("captures enum CHECK constraints so invalid statuses can be rejected", () => {
    const statusCheck = getTable("offset_leaves").checks.find((c) => c.column === "status")

    expect(statusCheck.kind).toBe("enum")
    expect(statusCheck.values).toEqual(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])
  })

  it("captures comparison CHECK constraints", () => {
    const hoursCheck = getTable("sil_leaves").checks.find((c) => c.column === "hours")

    expect(hoursCheck).toMatchObject({ kind: "comparison", operator: ">", value: 0 })
  })

  it("honours DROP CONSTRAINT from a later migration", () => {
    // 0013 drops sales_opportunities_lead_source_chk so lead sources can be
    // managed in crm_lead_sources instead of being frozen in the table.
    const names = getTable("sales_opportunities").checks.map((c) => c.name)

    expect(names).not.toContain("sales_opportunities_lead_source_chk")
  })

  it("parses volatile and literal column defaults", () => {
    expect(getColumn("tasks", "id").default).toEqual({ kind: "uuid" })
    expect(getColumn("tasks", "created_at").default).toEqual({ kind: "now" })
    expect(getColumn("tasks", "priority").default).toEqual({ kind: "const", value: "LOW" })
    expect(getColumn("tasks", "attachment_urls").default).toEqual({ kind: "const", value: [] })
    expect(getColumn("sales_opportunities", "registration_date").default).toEqual({
      kind: "today",
    })
    expect(getColumn("categories", "id").default).toEqual({ kind: "identity", column: "id" })
  })

  it("treats timezone-wrapped clock defaults as clock defaults", () => {
    // notifications.created_at is NOT NULL DEFAULT timezone('utc'::text, now()).
    // Reading that as a literal NULL would make every notification insert fail.
    expect(getColumn("notifications", "created_at").default).toEqual({ kind: "now" })
    expect(getColumn("task_activity", "created_at").default).toEqual({ kind: "now" })
  })
})

describe("relationship resolution", () => {
  it("resolves a hinted many-to-one embed to a single object", () => {
    const resolved = resolveRelation(
      "sales_opportunities",
      "employees",
      "sales_opportunities_deal_owner_id_fkey",
    )

    expect(resolved.cardinality).toBe("one")
    expect(resolved.relation.fromColumn).toBe("deal_owner_id")
  })

  it("resolves a hinted reverse embed to a collection", () => {
    const resolved = resolveRelation("tasks", "task_activity", "task_activity_task_id_fkey")

    expect(resolved.cardinality).toBe("many")
    expect(resolved.relation.fromColumn).toBe("task_id")
  })

  it("infers an unambiguous relationship with no hint", () => {
    const resolved = resolveRelation("system_updates", "employees", null)

    expect(resolved.relation.fromColumn).toBe("created_by")
  })

  it("rejects an unhinted embed when several foreign keys could match", () => {
    // sales_opportunities points at employees five different ways.
    expect(() => resolveRelation("sales_opportunities", "employees", null)).toThrow(
      /more than one relationship/i,
    )
  })

  it("rejects a constraint name that does not exist", () => {
    expect(() =>
      resolveRelation("tasks", "employees", "tasks_totally_made_up_fkey"),
    ).toThrow(/Could not find a relationship/i)
  })
})
