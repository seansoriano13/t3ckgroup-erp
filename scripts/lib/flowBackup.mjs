// Shared by scripts/backup-flows.mjs and scripts/restore-flow-backup.mjs.

/** Tables holding one flow's live canvas, in FK-safe insert order. `by` says how rows tie to the flow. */
export const FLOW_TABLES = [
    { table: "flow_snapshots", by: "flow" },
    { table: "flow_stages", by: "flow" },
    { table: "flow_edges", by: "flow" },
    { table: "flow_form_fields", by: "flow" },
    { table: "flow_access_settings", by: "flow" },
    { table: "flow_stage_actions", by: "stage" },
    { table: "stage_conditions", by: "stage" },
    { table: "flow_stage_fields", by: "stage" },
    { table: "flow_stage_follow_ups", by: "stage" },
    { table: "flow_stage_access", by: "stage" },
]

export function slug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "flow"
}

export function backupFileName(saleType, flow) {
    return `${slug(saleType?.name ?? flow.name ?? "flow")}-${flow.id.slice(0, 8)}.json`
}

/** Stable key order so an unchanged flow produces a byte-identical file. */
function sortKeys(v) {
    if (Array.isArray(v)) return v.map(sortKeys)
    if (v && typeof v === "object" && !(v instanceof Date)) {
        return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
    }
    return v
}

export function stableJson(obj) {
    return JSON.stringify(sortKeys(obj), null, 2) + "\n"
}

const rowKey = (r) => String(r.id ?? r.flow_id ?? r.stage_id)

export async function readFlowBundle(client, flow) {
    const { rows: [saleType] } = await client.query("select * from public.sale_types where id = $1", [flow.sale_type_id])
    const bundle = { format: 1, saleType: saleType ?? null, flow, tables: {} }
    const { rows: stages } = await client.query("select id from public.flow_stages where flow_id = $1", [flow.id])
    const stageIds = stages.map((s) => s.id)
    for (const { table, by } of FLOW_TABLES) {
        const { rows } = by === "flow"
            ? await client.query(`select * from public.${table} where flow_id = $1`, [flow.id])
            : await client.query(`select * from public.${table} where stage_id = any($1::uuid[])`, [stageIds])
        bundle.tables[table] = rows.sort((a, b) => rowKey(a).localeCompare(rowKey(b)))
    }
    return bundle
}

async function insertRows(client, table, rows) {
    if (!rows.length) return
    await client.query(
        `insert into public.${table} select * from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`,
        [JSON.stringify(rows)],
    )
}

/** Recreates a flow from a bundle with original UUIDs. Caller owns the transaction. */
export async function restoreBundle(client, bundle) {
    const { saleType, flow } = bundle
    const { rows: existing } = await client.query("select 1 from public.sales_flows where id = $1", [flow.id])
    if (existing.length) throw new Error(`Flow ${flow.id} already exists on the target; refusing to overwrite.`)
    if (saleType) {
        const { rows: st } = await client.query("select 1 from public.sale_types where id = $1", [saleType.id])
        if (!st.length) await insertRows(client, "sale_types", [saleType])
    }
    // flow <-> stage cycle: insert the flow without won_stage_id, patch it once the stages exist.
    await insertRows(client, "sales_flows", [{ ...flow, won_stage_id: null }])
    for (const { table } of FLOW_TABLES) await insertRows(client, table, bundle.tables[table] ?? [])
    if (flow.won_stage_id) {
        await client.query("update public.sales_flows set won_stage_id = $2 where id = $1", [flow.id, flow.won_stage_id])
    }
}
