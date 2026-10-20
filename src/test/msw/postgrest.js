/**
 * MSW handlers that speak PostgREST over the in-memory store.
 *
 * Because these sit at the HTTP boundary, the real @supabase/supabase-js client
 * runs untouched in every service test: its query builder, its retry wrapper in
 * src/lib/supabase.js, its `.single()` / count / representation semantics. What
 * a test exercises is the URL the application actually produces, not a
 * hand-written stand-in for the client's chaining API.
 */

import { http, HttpResponse } from "msw"
import { db, deleteRows, insertRow, updateRow } from "../db/store"
import { filterRows, orderRows, paginateRows, projectRows, splitParams } from "../db/query"

const BASE_URL = import.meta.env.VITE_SUPABASE_URL

/** Stubs for endpoints that are not tables: RPCs and edge functions. */
export const stubs = {
  rpc: new Map(),
  edgeFunctions: new Map(),
  // Fake of what a server-side edge function does after it has asked a stubbed
  // upstream: (body, upstreamAnswer) => response. Keyed by function name.
  edgeRaise: new Map(),
}

export function resetStubs() {
  stubs.rpc.clear()
  stubs.edgeFunctions.clear()
  stubs.edgeRaise.clear()
}

function preferences(request) {
  const prefer = request.headers.get("Prefer") ?? ""
  return {
    representation: prefer.includes("return=representation"),
    minimal: prefer.includes("return=minimal"),
    merge: prefer.includes("resolution=merge-duplicates"),
    ignore: prefer.includes("resolution=ignore-duplicates"),
    count: prefer.match(/count=(exact|planned|estimated)/)?.[1] ?? null,
  }
}

function wantsSingleObject(request) {
  return (request.headers.get("Accept") ?? "").includes("application/vnd.pgrst.object+json")
}

function errorResponse(error) {
  if (error?.pgrst) return HttpResponse.json(error.pgrst, { status: error.status ?? 400 })
  return HttpResponse.json(
    { code: "XX000", message: error?.message ?? "unexpected fake-database error", details: null, hint: null },
    { status: 500 },
  )
}

function contentRange(offset, returned, total) {
  const range = returned === 0 ? "*" : `${offset}-${offset + returned - 1}`
  return `${range}/${total ?? "*"}`
}

/**
 * Applies `.single()` semantics: PostgREST answers 406 with PGRST116 unless the
 * result set holds exactly one row.
 */
function respond(rows, { singular, status = 200, headers = {} }) {
  if (!singular) return HttpResponse.json(rows, { status, headers })
  if (rows.length === 1) return HttpResponse.json(rows[0], { status, headers })
  return HttpResponse.json(
    {
      code: "PGRST116",
      details: `Results contain ${rows.length} rows, application/vnd.pgrst.object+json requires 1 row`,
      hint: null,
      message: "JSON object requested, multiple (or no) rows returned",
    },
    { status: 406 },
  )
}

const readHandler = ({ request, params }) => {
  try {
    const url = new URL(request.url)
    const table = params.table
    db.internal.requireTable(table)

    const select = url.searchParams.get("select")
    const { base, embedded } = splitParams(select, url.searchParams)

    const matched = filterRows(table, db.internal.rowsOf(table), base)
    const ordered = orderRows(table, matched, url.searchParams.get("order"))
    const page = paginateRows(ordered, url.searchParams)

    const prefer = preferences(request)
    const offset = Number(url.searchParams.get("offset") ?? 0)
    const headers = {
      "Content-Range": contentRange(offset, page.length, prefer.count ? matched.length : null),
    }

    if (request.method === "HEAD") return new HttpResponse(null, { status: 200, headers })

    const projected = projectRows(table, page, select, embedded)
    return respond(projected, { singular: wantsSingleObject(request), headers })
  } catch (error) {
    return errorResponse(error)
  }
}

export const postgrestHandlers = [
  http.post(`${BASE_URL}/rest/v1/rpc/:fn`, async ({ request, params }) => {
    const stub = stubs.rpc.get(params.fn)
    if (!stub) {
      return HttpResponse.json(
        {
          code: "PGRST202",
          message: `Could not find the function public.${params.fn} in the schema cache`,
          details: "No RPC stub registered for this test — call stubRpc() to provide one.",
          hint: null,
        },
        { status: 404 },
      )
    }
    try {
      const body = await request.json().catch(() => ({}))
      return HttpResponse.json(await stub(body))
    } catch (error) {
      return errorResponse(error)
    }
  }),

  http.get(`${BASE_URL}/rest/v1/:table`, readHandler),
  http.head(`${BASE_URL}/rest/v1/:table`, readHandler),

  http.post(`${BASE_URL}/rest/v1/:table`, async ({ request, params }) => {
    try {
      const url = new URL(request.url)
      const prefer = preferences(request)
      const body = await request.json()
      const incoming = Array.isArray(body) ? body : [body]
      const table = params.table

      const written = incoming.map((row) => {
        if (!prefer.merge && !prefer.ignore) return insertRow(table, row)

        const conflictColumns =
          url.searchParams.get("on_conflict")?.split(",") ??
          db.internal.requireTable(table).primaryKey
        const existing = db.internal
          .rowsOf(table)
          .find((candidate) =>
            conflictColumns.every((column) => candidate[column] === row[column]),
          )

        if (!existing) return insertRow(table, row)
        if (prefer.ignore) return { ...existing }
        return updateRow(table, existing, row)
      })

      if (!prefer.representation) return new HttpResponse(null, { status: 201 })

      const projected = projectRows(table, written, url.searchParams.get("select"))
      return respond(projected, { singular: wantsSingleObject(request), status: 201 })
    } catch (error) {
      return errorResponse(error)
    }
  }),

  http.patch(`${BASE_URL}/rest/v1/:table`, async ({ request, params }) => {
    try {
      const url = new URL(request.url)
      const table = params.table
      db.internal.requireTable(table)

      const patch = await request.json()
      const targets = filterRows(table, db.internal.rowsOf(table), url.searchParams)
      const updated = targets.map((row) => updateRow(table, row, patch))

      if (!preferences(request).representation) return new HttpResponse(null, { status: 204 })

      const ordered = orderRows(table, updated, url.searchParams.get("order"))
      const projected = projectRows(table, ordered, url.searchParams.get("select"))
      return respond(projected, { singular: wantsSingleObject(request) })
    } catch (error) {
      return errorResponse(error)
    }
  }),

  http.delete(`${BASE_URL}/rest/v1/:table`, ({ request, params }) => {
    try {
      const url = new URL(request.url)
      const table = params.table
      db.internal.requireTable(table)

      const targets = filterRows(table, db.internal.rowsOf(table), url.searchParams)
      const removed = deleteRows(table, targets)

      if (!preferences(request).representation) return new HttpResponse(null, { status: 204 })

      const projected = projectRows(table, removed, url.searchParams.get("select"))
      return respond(projected, { singular: wantsSingleObject(request) })
    } catch (error) {
      return errorResponse(error)
    }
  }),
]

/** Registers the result a `supabase.rpc(name, args)` call should return. */
export function stubRpc(name, handler) {
  stubs.rpc.set(name, typeof handler === "function" ? handler : () => handler)
}

/** Registers the result a `supabase.functions.invoke(name, ...)` call returns. */
export function stubEdgeFunction(name, handler) {
  stubs.edgeFunctions.set(name, typeof handler === "function" ? handler : () => handler)
}
