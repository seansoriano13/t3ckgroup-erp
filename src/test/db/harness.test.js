import { beforeEach, describe, expect, it } from "vitest"
import { supabase } from "@/lib/supabase"
import { db } from "./store"

/**
 * Contract tests for the fake itself, driven through the real supabase-js
 * client. Every service test inherits whatever this file gets wrong, so the
 * behaviours asserted here are the ones PostgREST documents — not the ones that
 * happened to be convenient to implement.
 */
describe("fake PostgREST: reads", () => {
  beforeEach(() => {
    db.seed("employees", [
      { id: "emp-1", name: "Ana Reyes", department: "SALES", is_deleted: false },
      { id: "emp-2", name: "Ben Cruz", department: "IT", is_deleted: false },
      { id: "emp-3", name: "Cara Lim", department: "SALES", is_deleted: true },
    ])
  })

  it("round-trips an insert through a subsequent read", async () => {
    await supabase.from("employees").insert({ id: "emp-4", name: "Dee Santos" })

    const { data } = await supabase.from("employees").select("name").eq("id", "emp-4").single()

    expect(data).toEqual({ name: "Dee Santos" })
  })

  it("projects only the requested columns", async () => {
    const { data } = await supabase.from("employees").select("id, name").eq("id", "emp-1")

    expect(data).toEqual([{ id: "emp-1", name: "Ana Reyes" }])
  })

  it("answers .single() with an object and an empty result with PGRST116", async () => {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", "does-not-exist")
      .single()

    expect(data).toBeNull()
    expect(error.code).toBe("PGRST116")
  })

  it("rejects .single() when the filter matches more than one row", async () => {
    const { error } = await supabase
      .from("employees")
      .select("*")
      .eq("department", "SALES")
      .single()

    expect(error.code).toBe("PGRST116")
  })

  it("returns null rather than an error for .maybeSingle() on no match", async () => {
    const { data, error } = await supabase
      .from("employees")
      .select("*")
      .eq("id", "nobody")
      .maybeSingle()

    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it("orders ascending with NULLs last and descending with NULLs first", async () => {
    db.seed("employees", { id: "emp-9", name: null })

    const ascending = await supabase.from("employees").select("id").order("name")
    const descending = await supabase
      .from("employees")
      .select("id")
      .order("name", { ascending: false })

    expect(ascending.data.map((r) => r.id)).toEqual(["emp-1", "emp-2", "emp-3", "emp-9"])
    expect(descending.data.map((r) => r.id)).toEqual(["emp-9", "emp-3", "emp-2", "emp-1"])
  })

  it("supports in, or and ilike filters", async () => {
    const inFilter = await supabase.from("employees").select("id").in("id", ["emp-1", "emp-3"])
    const orFilter = await supabase
      .from("employees")
      .select("id")
      .or("department.eq.IT,name.eq.Ana Reyes")
    const ilike = await supabase.from("employees").select("id").ilike("name", "%cruz%")

    expect(inFilter.data.map((r) => r.id).sort()).toEqual(["emp-1", "emp-3"])
    expect(orFilter.data.map((r) => r.id).sort()).toEqual(["emp-1", "emp-2"])
    expect(ilike.data.map((r) => r.id)).toEqual(["emp-2"])
  })

  it("reports an exact count without returning rows for a head request", async () => {
    const { count, data } = await supabase
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("department", "SALES")

    expect(count).toBe(2)
    expect(data).toBeNull()
  })

  it("counts the full match set even when the page is limited", async () => {
    const { count, data } = await supabase
      .from("employees")
      .select("id", { count: "exact" })
      .limit(1)

    expect(count).toBe(3)
    expect(data).toHaveLength(1)
  })

  it("applies .range() as an inclusive window", async () => {
    const { data } = await supabase.from("employees").select("id").order("id").range(1, 2)

    expect(data.map((r) => r.id)).toEqual(["emp-2", "emp-3"])
  })
})

describe("fake PostgREST: SQL three-valued logic", () => {
  it("excludes NULL rows from a .neq() filter, the way Postgres does", async () => {
    // employees.is_deleted is nullable, and `NULL <> true` is unknown — so a
    // row that was never given a value does not survive .neq("is_deleted", true).
    db.seed("employees", [
      { id: "kept", name: "Has false", is_deleted: false },
      { id: "dropped", name: "Has null", is_deleted: null },
      { id: "excluded", name: "Is deleted", is_deleted: true },
    ])

    const { data } = await supabase.from("employees").select("id").neq("is_deleted", true)

    expect(data.map((r) => r.id)).toEqual(["kept"])
  })

  it("matches NULL rows with .is(null)", async () => {
    db.seed("employees", [
      { id: "null-dept", name: "No department", department: null },
      { id: "has-dept", name: "Has department", department: "IT" },
    ])

    const { data } = await supabase.from("employees").select("id").is("department", null)

    expect(data.map((r) => r.id)).toEqual(["null-dept"])
  })

  it("filters on a key inside a jsonb column", async () => {
    const author = db.seed("employees", { name: "Actor" })
    db.seed("system_audit_logs", [
      { type: "SYSTEM", content: "About Ana", metadata: { employeeId: "emp-ana" }, author_id: author.id },
      { type: "SYSTEM", content: "About Ben", metadata: { employeeId: "emp-ben" }, author_id: author.id },
      { type: "SYSTEM", content: "About nobody", metadata: null, author_id: author.id },
    ])

    const { data } = await supabase
      .from("system_audit_logs")
      .select("content")
      .eq("metadata->>employeeId", "emp-ana")

    expect(data).toEqual([{ content: "About Ana" }])
  })

  it("negates a filter with .not()", async () => {
    db.seed("employees", [
      { id: "it", name: "IT person", department: "IT" },
      { id: "sales", name: "Sales person", department: "SALES" },
    ])

    const { data } = await supabase.from("employees").select("id").not("department", "eq", "IT")

    expect(data.map((r) => r.id)).toEqual(["sales"])
  })
})

describe("fake PostgREST: embedded selects", () => {
  beforeEach(() => {
    db.seed("employees", [
      { id: "emp-owner", name: "Owner" },
      { id: "emp-registrar", name: "Registrar" },
    ])
    db.seed("sales_opportunities", {
      id: "opp-1",
      registered_by: "emp-registrar",
      deal_owner_id: "emp-owner",
      lead_source: "LGU",
      client_name: "City Hall",
      project_title: "Fire trucks",
    })
  })

  it("embeds a many-to-one relationship named by its constraint", async () => {
    const { data } = await supabase
      .from("sales_opportunities")
      .select("id, deal_owner:employees!sales_opportunities_deal_owner_id_fkey(id, name)")
      .eq("id", "opp-1")
      .single()

    expect(data).toEqual({ id: "opp-1", deal_owner: { id: "emp-owner", name: "Owner" } })
  })

  it("distinguishes two embeds of the same table by constraint", async () => {
    const { data } = await supabase
      .from("sales_opportunities")
      .select(
        `registrar:employees!sales_opportunities_registered_by_fkey(name),
         deal_owner:employees!sales_opportunities_deal_owner_id_fkey(name)`,
      )
      .eq("id", "opp-1")
      .single()

    expect(data).toEqual({ registrar: { name: "Registrar" }, deal_owner: { name: "Owner" } })
  })

  it("embeds a null object when the foreign key is unset", async () => {
    db.seed("sales_opportunities", {
      id: "opp-2",
      registered_by: "emp-registrar",
      deal_owner_id: null,
      lead_source: "NGA",
      client_name: "Agency",
      project_title: "Radios",
    })

    const { data } = await supabase
      .from("sales_opportunities")
      .select("deal_owner:employees!sales_opportunities_deal_owner_id_fkey(name)")
      .eq("id", "opp-2")
      .single()

    expect(data.deal_owner).toBeNull()
  })

  it("embeds a reverse one-to-many relationship as an array", async () => {
    db.seed("sales_opportunity_items", [
      { opportunity_id: "opp-1", product_name: "Pumper", quantity: 2, unit_price: 100 },
      { opportunity_id: "opp-1", product_name: "Ladder", quantity: 1, unit_price: 50 },
    ])

    const { data } = await supabase
      .from("sales_opportunities")
      .select("id, sales_opportunity_items(product_name)")
      .eq("id", "opp-1")
      .single()

    expect(data.sales_opportunity_items).toEqual([
      { product_name: "Pumper" },
      { product_name: "Ladder" },
    ])
  })

  it("empties a filtered embed but keeps the parent row, without !inner", async () => {
    // PostgREST semantics: `embed.column=eq.x` filters the EMBEDDED rows. The
    // parent survives with a null embed. Code that expects such a filter to
    // narrow the top-level list is mistaken, and this is where that shows.
    const { data } = await supabase
      .from("sales_opportunities")
      .select("id, deal_owner:employees!sales_opportunities_deal_owner_id_fkey(name)")
      .eq("deal_owner.name", "Nobody At All")

    expect(data).toEqual([{ id: "opp-1", deal_owner: null }])
  })

  it("drops the parent row when the filtered embed is marked !inner", async () => {
    const { data } = await supabase
      .from("sales_opportunities")
      .select("id, deal_owner:employees!sales_opportunities_deal_owner_id_fkey!inner(name)")
      .eq("deal_owner.name", "Nobody At All")

    expect(data).toEqual([])
  })

  it("surfaces a PostgREST error for a constraint name that does not exist", async () => {
    const { error } = await supabase
      .from("sales_opportunities")
      .select("owner:employees!sales_opportunities_typo_fkey(name)")

    expect(error.code).toBe("PGRST200")
  })
})

describe("fake PostgREST: writes and constraints", () => {
  beforeEach(() => {
    db.seed("employees", { id: "emp-1", name: "Ana Reyes" })
  })

  it("returns the inserted row when representation is requested", async () => {
    const { data } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: "emp-1", date: "2026-03-02", hours: 4, reason: "Clinic" })
      .select()
      .single()

    expect(data).toMatchObject({ employee_id: "emp-1", hours: 4, status: "PENDING" })
    expect(data.id).toBeTruthy()
  })

  it("applies column defaults declared in the schema", async () => {
    db.setClock("2026-06-15T08:30:00.000Z")

    const { data } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: "emp-1", date: "2026-03-02", hours: 1, reason: "Errand" })
      .select("status, created_at")
      .single()

    expect(data.status).toBe("PENDING")
    expect(data.created_at).toBe("2026-06-15T08:30:00.001Z")
  })

  it("rejects a NOT NULL violation with SQLSTATE 23502", async () => {
    const { error } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: "emp-1", date: "2026-03-02", hours: 2 })

    expect(error.code).toBe("23502")
    expect(error.message).toMatch(/reason/)
  })

  it("rejects a value outside a CHECK enum with SQLSTATE 23514", async () => {
    const { error } = await supabase
      .from("sil_leaves")
      .insert({
        employee_id: "emp-1",
        date: "2026-03-02",
        hours: 2,
        reason: "Errand",
        status: "APPROVED_MAYBE",
      })

    expect(error.code).toBe("23514")
  })

  it("rejects a value outside a CHECK comparison", async () => {
    const { error } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: "emp-1", date: "2026-03-02", hours: 0, reason: "Zero" })

    expect(error.code).toBe("23514")
  })

  it("rejects an orphan foreign key with SQLSTATE 23503", async () => {
    const { error } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: "ghost", date: "2026-03-02", hours: 2, reason: "Errand" })

    expect(error.code).toBe("23503")
  })

  it("rejects a duplicate primary key with SQLSTATE 23505", async () => {
    const { error } = await supabase.from("employees").insert({ id: "emp-1", name: "Clone" })

    expect(error.code).toBe("23505")
  })

  it("rejects a write to a column that is not in the schema", async () => {
    const { error } = await supabase
      .from("employees")
      .insert({ name: "Typo", departmnet: "SALES" })

    expect(error.code).toBe("PGRST204")
  })

  it("updates only the rows a filter matches", async () => {
    db.seed("employees", { id: "emp-2", name: "Ben Cruz", department: "IT" })

    await supabase.from("employees").update({ department: "OPS" }).eq("id", "emp-2")

    const { data } = await supabase.from("employees").select("id, department").order("id")
    expect(data).toEqual([
      { id: "emp-1", department: null },
      { id: "emp-2", department: "OPS" },
    ])
  })

  it("re-validates constraints on update", async () => {
    const { data: leave } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: "emp-1", date: "2026-03-02", hours: 2, reason: "Errand" })
      .select()
      .single()

    const { error } = await supabase
      .from("sil_leaves")
      .update({ status: "NOT_A_STATUS" })
      .eq("id", leave.id)

    expect(error.code).toBe("23514")
  })

  it("deletes matching rows and can return them", async () => {
    db.seed("employees", { id: "emp-2", name: "Ben Cruz" })

    const { data: removed } = await supabase
      .from("employees")
      .delete()
      .eq("id", "emp-2")
      .select("name")

    expect(removed).toEqual([{ name: "Ben Cruz" }])

    const { data: left } = await supabase.from("employees").select("id")
    expect(left.map((r) => r.id)).toEqual(["emp-1"])
  })

  it("merges duplicates on upsert instead of failing the unique check", async () => {
    db.seed("crm_lead_sources", { value: "LGU", label: "LGU" })

    await supabase
      .from("crm_lead_sources")
      .upsert({ value: "LGU", label: "Local Government Unit" })

    const { data } = await supabase.from("crm_lead_sources").select("label").eq("value", "LGU")
    expect(data).toEqual([{ label: "Local Government Unit" }])
  })
})

describe("fake PostgREST: row triggers", () => {
  beforeEach(() => {
    db.seed("employees", { id: "emp-1", name: "Ana Reyes" })
  })

  const registerLead = (overrides = {}) =>
    supabase
      .from("sales_opportunities")
      .insert({
        registered_by: "emp-1",
        lead_source: "LGU",
        client_name: "City Hall",
        project_title: "Fire trucks",
        registration_date: "2026-03-01",
        ...overrides,
      })
      .select()
      .single()

  it("no longer mints an opportunity_no", async () => {
    // 0012 dropped the sequence trigger. The number used the same S0#### shape
    // as an Odoo sales reference but pointed at an unrelated record, so the
    // Sales Reference is now the only S0 number in the product.
    const { data } = await registerLead()

    expect(data.opportunity_no).toBeNull()
  })

  it("refuses to register beyond Lead without a sales reference", async () => {
    const { error } = await registerLead({ status: "QUALIFIED" })

    expect(error.code).toBe("P0001")
    expect(error.message).toMatch(/Sales Reference/i)
  })

  it("upper-cases a sales reference on the way in", async () => {
    const { data } = await registerLead({ status: "QUALIFIED", sales_reference: " s01237 " })

    expect(data.sales_reference).toBe("S01237")
  })

  it("blocks a stage move out of Lead when no reference is on record", async () => {
    const { data: lead } = await registerLead()

    const { error } = await supabase
      .from("sales_opportunities")
      .update({ status: "QUALIFIED" })
      .eq("id", lead.id)

    expect(error.code).toBe("P0001")
  })

  it("allows a lead to be lost without ever having been quoted", async () => {
    const { data: lead } = await registerLead()

    const { error } = await supabase
      .from("sales_opportunities")
      .update({ status: "CLOSED_LOST" })
      .eq("id", lead.id)

    expect(error).toBeNull()
  })

  it("holds registration_date immutable, since it settles deal ownership", async () => {
    const { data: lead } = await registerLead()

    const { error } = await supabase
      .from("sales_opportunities")
      .update({ registration_date: "2026-01-01" })
      .eq("id", lead.id)

    expect(error.message).toMatch(/registration_date is immutable/)
  })

  it("recomputes expected_value from the item rows on insert", async () => {
    const { data: lead } = await registerLead()

    await supabase.from("sales_opportunity_items").insert([
      { opportunity_id: lead.id, product_name: "Pumper", quantity: 2, unit_price: 1500 },
      { opportunity_id: lead.id, product_name: "Ladder", quantity: 1, unit_price: 500 },
    ])

    const { data } = await supabase
      .from("sales_opportunities")
      .select("expected_value")
      .eq("id", lead.id)
      .single()
    expect(data.expected_value).toBe(3500)
  })

  it("recomputes expected_value when items are deleted", async () => {
    const { data: lead } = await registerLead()
    await supabase
      .from("sales_opportunity_items")
      .insert({ opportunity_id: lead.id, product_name: "Pumper", quantity: 2, unit_price: 1500 })

    await supabase.from("sales_opportunity_items").delete().eq("opportunity_id", lead.id)

    const { data } = await supabase
      .from("sales_opportunities")
      .select("expected_value")
      .eq("id", lead.id)
      .single()
    expect(data.expected_value).toBe(0)
  })
})

describe("fake PostgREST: determinism", () => {
  it("issues generated ids as a fixed, repeatable sequence", async () => {
    const { data } = await supabase
      .from("employees")
      .insert([{ name: "First" }, { name: "Second" }])
      .select("id")

    expect(data.map((r) => r.id)).toEqual([
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000002",
    ])
  })

  it("advances clock defaults monotonically, close to real time", async () => {
    const before = Date.now()

    const { data } = await supabase
      .from("employees")
      .insert([{ name: "First" }, { name: "Second" }])
      .select("created_at")

    // Wall-clock, not a frozen epoch: services compare stored timestamps
    // against Date.now(), and a store stuck in the past breaks those windows.
    expect(new Date(data[0].created_at).getTime()).toBeGreaterThanOrEqual(before)
    expect(new Date(data[1].created_at).getTime()).toBeGreaterThan(
      new Date(data[0].created_at).getTime(),
    )
  })

  it("lets a test pin the clock when a timestamp is being asserted", async () => {
    const employee = db.seed("employees", { name: "Pinned" })
    db.setClock("2026-06-15T08:30:00.000Z")

    const { data } = await supabase
      .from("sil_leaves")
      .insert({ employee_id: employee.id, date: "2026-06-15", hours: 1, reason: "Clinic" })
      .select("created_at")
      .single()

    expect(data.created_at).toBe("2026-06-15T08:30:00.001Z")
  })

  it("starts each test from an empty database", async () => {
    const { data } = await supabase.from("employees").select("id")

    expect(data).toEqual([])
  })
})
