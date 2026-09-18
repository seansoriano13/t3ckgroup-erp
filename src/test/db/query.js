/**
 * PostgREST query semantics over the in-memory store: filters, logical trees,
 * ordering, pagination and `select` projection including embedded resources.
 *
 * The filters use SQL three-valued logic on purpose. `.neq("is_deleted", true)`
 * does NOT match a row whose `is_deleted` is NULL, because `NULL <> true` is
 * unknown — and several tables in this schema leave that column nullable. A
 * fake that treated it as a plain `!==` would hide exactly the class of bug
 * this harness exists to catch.
 */

import { getColumn, getTable, pgrstError, resolveRelation } from "./schema"
import { db } from "./store"

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"])

const UNKNOWN = null

/** Splits on top-level commas, ignoring those inside parentheses or quotes. */
function splitTopLevel(input, separator = ",") {
  const parts = []
  let depth = 0
  let quoted = false
  let current = ""
  for (const ch of input) {
    if (ch === '"') quoted = !quoted
    if (!quoted && ch === "(") depth += 1
    if (!quoted && ch === ")") depth -= 1
    if (!quoted && depth === 0 && ch === separator) {
      parts.push(current)
      current = ""
      continue
    }
    current += ch
  }
  if (current !== "") parts.push(current)
  return parts
}

function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Splits a filter target into its base column and JSON path, supporting the
 * `metadata->>employeeId` form the audit-log filters use. `->>` yields text,
 * `->` yields the raw JSON value.
 */
export function parseColumnRef(reference) {
  if (!reference.includes("->")) return { column: reference, path: [], asText: false }
  const [column, ...rest] = reference.split(/->>?/)
  return {
    column,
    path: rest.filter(Boolean),
    asText: reference.includes("->>"),
  }
}

function readColumn(row, reference) {
  const { column, path, asText } = parseColumnRef(reference)
  let value = row[column]
  for (const key of path) {
    if (value == null) return null
    value = value[key]
  }
  if (value == null) return null
  return asText && typeof value !== "string" ? String(value) : value
}

/** Casts a filter's URL text to the type the target column stores. */
function castOperand(tableName, columnRef, raw) {
  const text = unquote(raw)
  if (text === "null") return null
  const { column: columnName, path } = parseColumnRef(columnRef)
  // A value read out of JSON has no declared column type to cast against.
  if (path.length > 0) return text
  const column = getColumn(tableName, columnName)
  if (!column) return text
  if (column.type === "number") {
    const n = Number(text)
    return Number.isNaN(n) ? text : n
  }
  if (column.type === "boolean") {
    if (text === "true") return true
    if (text === "false") return false
  }
  return text
}

/**
 * Translates a SQL LIKE pattern to a RegExp.
 *
 * A backslash escapes the next character, so `\%` matches a literal percent
 * sign — which is exactly what the audit-log search relies on when a user types
 * "50%" into the box.
 */
function likeToRegExp(pattern, flags) {
  let source = "^"
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === "\\" && i + 1 < pattern.length) {
      source += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      continue
    }
    if (ch === "%" || ch === "*") source += ".*"
    else if (ch === "_") source += "."
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`${source}$`, flags)
}

/** Evaluates a single `column=op.value` predicate, returning true/false/UNKNOWN. */
function evaluateComparison(row, tableName, columnName, operator, rawValue) {
  const actual = readColumn(row, columnName)

  if (operator === "is") {
    const text = unquote(rawValue)
    if (text === "null") return actual == null
    if (text === "true") return actual === true
    if (text === "false") return actual === false
    if (text === "unknown") return actual == null
    return actual === text
  }

  if (operator === "in") {
    const inner = rawValue.trim().replace(/^\(/, "").replace(/\)$/, "")
    if (actual == null) return UNKNOWN
    const values = splitTopLevel(inner).map((v) => castOperand(tableName, columnName, v))
    return values.includes(actual)
  }

  if (operator === "cs") {
    if (actual == null) return UNKNOWN
    const text = rawValue.trim()
    if (text.startsWith("{")) {
      const wanted = text.slice(1, -1).split(",").map(unquote).filter((v) => v !== "")
      return Array.isArray(actual) && wanted.every((v) => actual.map(String).includes(v))
    }
    const wanted = JSON.parse(text)
    return Object.entries(wanted).every(
      ([key, value]) => JSON.stringify(actual?.[key]) === JSON.stringify(value),
    )
  }

  if (operator === "like" || operator === "ilike") {
    if (actual == null) return UNKNOWN
    // SQL LIKE/ILIKE's `%` matches any sequence of characters, newlines
    // included — `s` (dotAll) keeps `.` doing the same, or a `%` before a
    // multi-line value (e.g. a task description) fails to match anything
    // after the first newline.
    const flags = operator === "ilike" ? "is" : "s"
    return likeToRegExp(unquote(rawValue), flags).test(String(actual))
  }

  const expected = castOperand(tableName, columnName, rawValue)
  if (actual == null || expected == null) return UNKNOWN

  switch (operator) {
    case "eq":
      return actual === expected
    case "neq":
      return actual !== expected
    case "gt":
      return actual > expected
    case "gte":
      return actual >= expected
    case "lt":
      return actual < expected
    case "lte":
      return actual <= expected
    default:
      throw pgrstError("PGRST100", `unknown filter operator "${operator}"`, { status: 400 })
  }
}

function negate(result) {
  if (result === UNKNOWN) return UNKNOWN
  return !result
}

/** Parses `column`, `op.value` into a predicate node. */
function parsePredicate(tableName, columnName, expression) {
  const base = parseColumnRef(columnName).column
  if (!getColumn(tableName, base)) {
    throw pgrstError("42703", `column "${base}" of relation "${tableName}" does not exist`, {
      status: 400,
    })
  }

  let rest = expression
  let negated = false
  if (rest.startsWith("not.")) {
    negated = true
    rest = rest.slice(4)
  }

  const dot = rest.indexOf(".")
  if (dot === -1) {
    throw pgrstError("PGRST100", `malformed filter "${columnName}=${expression}"`, { status: 400 })
  }
  const operator = rest.slice(0, dot)
  const value = rest.slice(dot + 1)

  return { type: "predicate", tableName, columnName, operator, value, negated }
}

/** Parses the body of an `or=(...)` / `and=(...)` group into a logical node. */
function parseLogicalGroup(tableName, type, body) {
  const inner = body.trim().replace(/^\(/, "").replace(/\)$/, "")
  const children = splitTopLevel(inner).map((part) => {
    const trimmed = part.trim()
    const nested = trimmed.match(/^(not\.)?(or|and)(\([\s\S]*\))$/i)
    if (nested) {
      const node = parseLogicalGroup(tableName, nested[2].toLowerCase(), nested[3])
      return nested[1] ? { type: "not", child: node } : node
    }
    const dot = trimmed.indexOf(".")
    return parsePredicate(tableName, trimmed.slice(0, dot), trimmed.slice(dot + 1))
  })
  return { type, children }
}

function evaluateNode(row, node) {
  if (node.type === "predicate") {
    const result = evaluateComparison(
      row,
      node.tableName,
      node.columnName,
      node.operator,
      node.value,
    )
    return node.negated ? negate(result) : result
  }
  if (node.type === "not") return negate(evaluateNode(row, node.child))

  const results = node.children.map((child) => evaluateNode(row, child))
  if (node.type === "or") {
    if (results.some((r) => r === true)) return true
    if (results.some((r) => r === UNKNOWN)) return UNKNOWN
    return false
  }
  if (results.some((r) => r === false)) return false
  if (results.some((r) => r === UNKNOWN)) return UNKNOWN
  return true
}

/**
 * Collects the top-level aliases a select clause embeds, so a filter written
 * as `task.logged_by=eq.x` can be recognised as targeting the embed rather
 * than a column of the base table.
 */
function embeddedAliases(select) {
  return new Set(
    parseSelect(select)
      .filter((field) => field.children != null)
      .map((field) => field.alias ?? field.name),
  )
}

/**
 * Splits search params into filters on the base table and filters aimed at an
 * embedded resource.
 *
 * PostgREST treats `embed.column=eq.value` as a filter on the EMBEDDED rows,
 * not on the parent: without an `!inner` modifier the parent row is still
 * returned, with the embed emptied out. Reproducing that faithfully is the
 * point — a screen that expects such a filter to narrow the list gets the same
 * surprise here that it gets in production.
 */
export function splitParams(select, searchParams) {
  const aliases = embeddedAliases(select)
  const base = new URLSearchParams()
  const embedded = new Map()

  for (const [key, value] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue
    const dot = key.indexOf(".")
    const prefix = dot === -1 ? null : key.slice(0, dot)
    if (prefix && aliases.has(prefix)) {
      if (!embedded.has(prefix)) embedded.set(prefix, [])
      embedded.get(prefix).push([key.slice(dot + 1), value])
      continue
    }
    base.append(key, value)
  }
  return { base, embedded }
}

/** Builds the predicate tree implied by every non-reserved search param. */
export function buildFilter(tableName, searchParams) {
  const nodes = []
  for (const [key, value] of searchParams.entries()) {
    if (RESERVED_PARAMS.has(key)) continue
    if (key === "or" || key === "and") {
      nodes.push(parseLogicalGroup(tableName, key, value))
      continue
    }
    nodes.push(parsePredicate(tableName, key, value))
  }
  return { type: "and", children: nodes }
}

export function filterRows(tableName, rows, searchParams) {
  const filter = buildFilter(tableName, searchParams)
  if (filter.children.length === 0) return [...rows]
  return rows.filter((row) => evaluateNode(row, filter) === true)
}

function matchesEmbeddedFilters(tableName, row, predicates) {
  if (!predicates || predicates.length === 0) return true
  return predicates.every(([column, expression]) => {
    const node = parsePredicate(tableName, column, expression)
    return evaluateNode(row, node) === true
  })
}

/**
 * Orders rows the way Postgres does: ASC puts NULLs last, DESC puts them first,
 * unless the request says otherwise. Ties keep insertion order.
 */
export function orderRows(tableName, rows, orderParam) {
  if (!orderParam) return rows
  const terms = orderParam.split(",").map((term) => {
    const [column, ...modifiers] = term.split(".")
    const descending = modifiers.includes("desc")
    let nullsFirst = descending
    if (modifiers.includes("nullsfirst")) nullsFirst = true
    if (modifiers.includes("nullslast")) nullsFirst = false
    if (!getColumn(tableName, column)) {
      throw pgrstError("42703", `column "${column}" of relation "${tableName}" does not exist`, {
        status: 400,
      })
    }
    return { column, descending, nullsFirst }
  })

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const term of terms) {
        const left = a.row[term.column]
        const right = b.row[term.column]
        if (left == null && right == null) continue
        if (left == null) return term.nullsFirst ? -1 : 1
        if (right == null) return term.nullsFirst ? 1 : -1
        if (left < right) return term.descending ? 1 : -1
        if (left > right) return term.descending ? -1 : 1
      }
      return a.index - b.index
    })
    .map(({ row }) => row)
}

export function paginateRows(rows, searchParams) {
  const offset = Number(searchParams.get("offset") ?? 0)
  const limitParam = searchParams.get("limit")
  const limit = limitParam == null ? rows.length : Number(limitParam)
  return rows.slice(offset, offset + limit)
}

/**
 * Parses a `select` clause into field nodes.
 * Grammar: `[alias:]name[!hint][(nested)]`, comma separated.
 */
export function parseSelect(select) {
  const source = (select ?? "*").trim() || "*"
  return splitTopLevel(source)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const open = part.indexOf("(")
      const head = open === -1 ? part : part.slice(0, open)
      const body = open === -1 ? null : part.slice(open + 1, part.lastIndexOf(")"))

      let alias = null
      let name = head.trim()
      const colon = name.indexOf(":")
      if (colon !== -1) {
        alias = name.slice(0, colon).trim()
        name = name.slice(colon + 1).trim()
      }

      // A field can carry both a constraint hint and a join modifier:
      // `deal_owner:employees!some_fkey!inner(name)`.
      let hint = null
      let modifier = null
      const [head_, ...bangs] = name.split("!")
      name = head_.trim()
      for (const part of bangs.map((p) => p.trim())) {
        if (part === "inner" || part === "left") modifier = part
        else hint = part
      }

      return { alias, name, hint, modifier, children: body == null ? null : parseSelect(body) }
    })
}

/**
 * Projects rows through a parsed select clause, resolving embeds recursively.
 * `embeddedFilters` is the map produced by splitParams().
 */
export function projectRows(tableName, rows, select, embeddedFilters = new Map()) {
  const fields = parseSelect(select)
  const table = getTable(tableName)

  return rows
    .map((row) => {
      const output = {}
      let dropped = false

      for (const field of fields) {
        if (field.children == null) {
          if (field.name === "*") {
            for (const column of Object.keys(table.columns)) output[column] = row[column]
            continue
          }
          if (!table.columns[field.name]) {
            throw pgrstError(
              "42703",
              `column ${tableName}.${field.name} does not exist`,
              { status: 400 },
            )
          }
          output[field.alias ?? field.name] = row[field.name]
          continue
        }

        const { relation, cardinality } = resolveRelation(tableName, field.name, field.hint)
        const key = field.alias ?? field.name
        const predicates = embeddedFilters.get(key)

        if (cardinality === "one") {
          const parentValue = row[relation.fromColumn]
          const match = db.internal
            .rowsOf(relation.toTable)
            .find(
              (candidate) =>
                candidate[relation.toColumn] === parentValue &&
                matchesEmbeddedFilters(relation.toTable, candidate, predicates),
            )
          if (!match && field.modifier === "inner") {
            dropped = true
            break
          }
          output[key] = match
            ? projectRows(relation.toTable, [match], serialiseSelect(field.children))[0]
            : null
        } else {
          const parentValue = row[relation.toColumn]
          const matches = db.internal
            .rowsOf(relation.fromTable)
            .filter(
              (candidate) =>
                candidate[relation.fromColumn] === parentValue &&
                matchesEmbeddedFilters(relation.fromTable, candidate, predicates),
            )
          if (matches.length === 0 && field.modifier === "inner") {
            dropped = true
            break
          }
          output[key] = projectRows(
            relation.fromTable,
            matches,
            serialiseSelect(field.children),
          )
        }
      }

      return dropped ? null : output
    })
    .filter((row) => row !== null)
}

/** Rebuilds a select string from parsed nodes so nesting can recurse. */
function serialiseSelect(fields) {
  return fields
    .map((field) => {
      const alias = field.alias ? `${field.alias}:` : ""
      const hint = `${field.hint ? `!${field.hint}` : ""}${field.modifier ? `!${field.modifier}` : ""}`
      const children = field.children ? `(${serialiseSelect(field.children)})` : ""
      return `${alias}${field.name}${hint}${children}`
    })
    .join(",")
}
