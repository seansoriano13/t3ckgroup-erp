/**
 * Builds the fake database's schema by parsing the project's real, executable
 * SQL: every file in `supabase/migrations/`, in order. `t3ckgroup.sql` at the
 * repo root is deliberately not a source — see sqlSources() for why.
 *
 * Nothing about the schema is hand-maintained here. Add a table or a column in
 * a migration and the fake picks it up on the next test run — that is the whole
 * point. What the parser understands:
 *
 *   - CREATE TABLE  → columns, types, NOT NULL, DEFAULT, UNIQUE, PRIMARY KEY
 *   - CONSTRAINT    → PRIMARY KEY / FOREIGN KEY / CHECK, by name
 *   - ALTER TABLE   → ADD COLUMN, ADD CONSTRAINT, DROP CONSTRAINT
 *
 * Foreign keys are indexed by constraint name because that is exactly how
 * PostgREST disambiguates embedded selects
 * (`deal_owner:employees!sales_opportunities_deal_owner_id_fkey(...)`), so a
 * typo'd constraint name in application code fails here the way it fails in
 * production.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

const COLUMN_MODIFIERS =
  /\s+(not\s+null|null|default|unique|primary\s+key|check|references|generated|collate)\b/i

/** Strips `-- ...` comments without touching quoted text. */
function stripComments(sql) {
  let out = ""
  let inString = false
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i]
    if (inString) {
      out += ch
      if (ch === "'") inString = sql[i + 1] === "'" ? (out += sql[++i], true) : false
      continue
    }
    if (ch === "'") {
      inString = true
      out += ch
      continue
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1
      out += "\n"
      continue
    }
    out += ch
  }
  return out
}

/** Splits on commas that sit at paren depth zero and outside quotes. */
function splitTopLevel(body) {
  const parts = []
  let depth = 0
  let current = ""
  let inString = false
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (inString) {
      current += ch
      if (ch === "'") inString = false
      continue
    }
    if (ch === "'") {
      inString = true
      current += ch
      continue
    }
    if (ch === "(") depth += 1
    if (ch === ")") depth -= 1
    if (ch === "," && depth === 0) {
      parts.push(current.trim())
      current = ""
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Normalises a Postgres type to the coarse kind the fake needs for coercion. */
function classifyType(rawType) {
  const type = rawType.toLowerCase().trim()
  if (type.endsWith("[]") || type.startsWith("array")) return "array"
  if (/\b(jsonb|json)\b/.test(type)) return "json"
  if (/\b(boolean|bool)\b/.test(type)) return "boolean"
  if (/\b(numeric|decimal|real|double|integer|int|int2|int4|int8|bigint|smallint|serial)\b/.test(type))
    return "number"
  if (/\b(timestamp|timestamptz|date|time)\b/.test(type)) return "datetime"
  return "text"
}

/**
 * Turns a DEFAULT expression into a thunk. Volatile defaults (uuids, clocks,
 * identity sequences) are resolved at insert time against the store's clock so
 * every run produces the same ids in the same order.
 */
function parseDefault(expr) {
  if (expr == null) return null
  const raw = expr.trim().replace(/::[a-z_ ]+(\[\])?$/i, "").trim()
  const lower = raw.toLowerCase()

  if (lower === "gen_random_uuid()" || lower === "uuid_generate_v4()") return { kind: "uuid" }
  // now(), and the timezone('utc', now()) / now() at time zone 'utc' variants
  // this schema also uses.
  if (lower === "now()" || lower === "current_timestamp" || /\bnow\s*\(\s*\)/.test(lower)) {
    return { kind: "now" }
  }
  if (lower === "current_date") return { kind: "today" }
  if (lower === "true") return { kind: "const", value: true }
  if (lower === "false") return { kind: "const", value: false }
  if (lower === "null") return { kind: "const", value: null }

  const quoted = raw.match(/^'([\s\S]*)'$/)
  if (quoted) {
    const inner = quoted[1].replace(/''/g, "'")
    if (inner === "{}") return { kind: "const", value: [] }
    if (inner === "[]") return { kind: "const", value: [] }
    if (inner === "" || !inner.startsWith("{")) return { kind: "const", value: inner }
    return { kind: "const", value: inner.slice(1, -1).split(",").filter(Boolean) }
  }

  if (/^-?\d+(\.\d+)?$/.test(raw)) return { kind: "const", value: Number(raw) }
  return { kind: "const", value: null }
}

/**
 * Recognises the CHECK shapes this schema actually uses, so that writing an
 * unlisted status is rejected the way Postgres would reject it. Anything more
 * exotic is recorded as unenforced rather than guessed at.
 */
function parseCheck(name, expression) {
  const expr = expression.trim()

  const anyArray = expr.match(/\(?\s*([a-z_0-9]+)\s*=\s*ANY\s*\(\s*ARRAY\s*\[([\s\S]*?)\]/i)
  if (anyArray) {
    const values = anyArray[2]
      .split(",")
      .map((v) => v.trim().replace(/::[a-z_ ]+$/i, "").replace(/^'([\s\S]*)'$/, "$1"))
    return { name, kind: "enum", column: anyArray[1], values }
  }

  const inList = expr.match(/\(?\s*([a-z_0-9]+)\s+IN\s*\(([\s\S]*?)\)/i)
  if (inList) {
    const values = inList[2]
      .split(",")
      .map((v) => v.trim().replace(/::[a-z_ ]+$/i, "").replace(/^'([\s\S]*)'$/, "$1"))
    return { name, kind: "enum", column: inList[1], values }
  }

  const comparison = expr.match(/\(?\s*([a-z_0-9]+)\s*(>=|<=|>|<)\s*(-?[\d.]+)/)
  if (comparison) {
    return {
      name,
      kind: "comparison",
      column: comparison[1],
      operator: comparison[2],
      value: Number(comparison[3]),
    }
  }

  return { name, kind: "unenforced", expression: expr }
}

function emptyTable(name) {
  return {
    name,
    columns: {},
    primaryKey: [],
    foreignKeys: {},
    checks: [],
    unique: [],
    uniqueIndexes: [],
    identity: [],
  }
}

/**
 * Matches Postgres' own default naming for an unnamed column-level
 * constraint: `<table>_<column>_fkey`. This project's migrations lean on
 * inline `references` rather than a named table-level FOREIGN KEY constraint
 * (see 0001, 0003, 0008), and the application queries embed against exactly
 * that generated name — e.g. `!sales_opportunities_registered_by_fkey` — so a
 * parser that only understood named constraints would silently drop these
 * relationships.
 */
function parseColumn(table, part, registry) {
  const match = part.match(/^"?([a-z_0-9]+)"?\s+([\s\S]+)$/i)
  if (!match) return
  const [, name, rest] = match

  const modifierAt = rest.search(COLUMN_MODIFIERS)
  const rawType = modifierAt === -1 ? rest : rest.slice(0, modifierAt)
  const modifiers = modifierAt === -1 ? "" : rest.slice(modifierAt)

  const defaultMatch = modifiers.match(/\bdefault\s+([\s\S]+?)(?=\s+(?:not\s+null|null|unique|primary\s+key|check|references|generated|collate)\b|$)/i)
  const checkMatch = modifiers.match(/\bcheck\s*\(([\s\S]*)\)\s*$/i)
  const referencesMatch = modifiers.match(
    /\breferences\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(\s*"?([a-z_0-9]+)"?\s*\)/i,
  )

  table.columns[name] = {
    name,
    type: classifyType(rawType),
    rawType: rawType.trim(),
    notNull: /\bnot\s+null\b/i.test(modifiers),
    default: parseDefault(defaultMatch?.[1] ?? null),
  }

  if (/\bgenerated\b[\s\S]*\bidentity\b/i.test(modifiers)) {
    table.identity.push(name)
    table.columns[name].default = { kind: "identity", column: name }
  }
  if (/\bprimary\s+key\b/i.test(modifiers) && !table.primaryKey.includes(name)) {
    table.primaryKey.push(name)
  }
  if (/\bunique\b/i.test(modifiers)) table.unique.push([name])
  if (checkMatch) table.checks.push(parseCheck(`${table.name}_${name}_check`, checkMatch[1]))

  if (referencesMatch && registry) {
    const constraintName = `${table.name}_${name}_fkey`
    const relation = {
      constraint: constraintName,
      fromTable: table.name,
      fromColumn: name,
      toTable: referencesMatch[1],
      toColumn: referencesMatch[2],
    }
    table.foreignKeys[constraintName] = relation
    registry.relationsByConstraint[constraintName] = relation
  }
}

function parseConstraint(table, part, registry) {
  const named = part.match(/^constraint\s+"?([a-z_0-9]+)"?\s+([\s\S]+)$/i)
  const name = named ? named[1] : `${table.name}_anonymous_${table.checks.length}`
  const body = named ? named[2] : part

  const pk = body.match(/^primary\s+key\s*\(([^)]*)\)/i)
  if (pk) {
    table.primaryKey = pk[1].split(",").map((c) => c.trim().replace(/"/g, ""))
    return true
  }

  const fk = body.match(
    /^foreign\s+key\s*\(([^)]*)\)\s*references\s+(?:public\.)?"?([a-z_0-9]+)"?\s*\(([^)]*)\)/i,
  )
  if (fk) {
    const relation = {
      constraint: name,
      fromTable: table.name,
      fromColumn: fk[1].trim().replace(/"/g, ""),
      toTable: fk[2],
      toColumn: fk[3].trim().replace(/"/g, ""),
    }
    table.foreignKeys[name] = relation
    registry.relationsByConstraint[name] = relation
    return true
  }

  const check = body.match(/^check\s*\(([\s\S]*)\)\s*$/i)
  if (check) {
    table.checks.push(parseCheck(name, check[1]))
    return true
  }

  const unique = body.match(/^unique\s*\(([^)]*)\)/i)
  if (unique) {
    table.unique.push(unique[1].split(",").map((c) => c.trim().replace(/"/g, "")))
    return true
  }

  return false
}

/**
 * `create unique index ... on t (cols) where <flag>`.
 *
 * Standalone indexes used to be skipped entirely, which meant a partial unique
 * index — Postgres's way of saying "at most one row may have this flag set" —
 * was invisible to the harness and silently unenforced. crm_pipeline_stages
 * relies on four of them to guarantee a single anchor, entry, won and lost
 * stage, so the fake database has to honour them or its tests prove nothing.
 *
 * Only the predicate forms actually used are understood: a bare boolean column
 * and its negation. Anything else is left unenforced rather than guessed at,
 * the same way an unrecognised CHECK is.
 */
function applyCreateIndex(sql, registry) {
  const head = /create\s+unique\s+index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+"?([a-z_0-9]+)"?\s+on\s+(?:public\.)?"?([a-z_0-9]+)"?\s*/gi
  let match
  while ((match = head.exec(sql))) {
    const [, name, tableName] = match
    const table = registry.tables[tableName]
    if (!table) continue

    // Hand-scan the key list: `((true))` and `(a, b)` both start at the same
    // paren, and a regex cannot balance them.
    let i = head.lastIndex
    if (sql[i] !== "(") continue
    let depth = 0
    let end = -1
    for (let j = i; j < sql.length; j++) {
      if (sql[j] === "(") depth += 1
      else if (sql[j] === ")") {
        depth -= 1
        if (depth === 0) { end = j; break }
      }
    }
    if (end === -1) continue

    const keyBody = sql.slice(i + 1, end).trim()
    const tail = sql.slice(end + 1, sql.indexOf(";", end) === -1 ? undefined : sql.indexOf(";", end))
    const whereMatch = tail.match(/\bwhere\s+([\s\S]+)$/i)

    let where = null
    if (whereMatch) {
      const predicate = whereMatch[1].trim().replace(/\s+/g, " ")
      const negated = /^not\s+/i.test(predicate)
      const column = predicate.replace(/^not\s+/i, "").replace(/\s+is\s+(true|false)$/i, "").trim()
      if (!/^[a-z_0-9]+$/i.test(column) || !table.columns[column]) continue
      where = { column, negated }
    }

    // A key list of column names dedupes on those columns; anything else is an
    // expression over constants, where every matching row shares one key.
    const parts = keyBody.split(",").map((c) => c.trim().replace(/"/g, ""))
    const columns = parts.every((c) => table.columns[c]) ? parts : null

    table.uniqueIndexes.push({ name, columns, where })
  }
}

function applyCreateTable(sql, registry) {
  const pattern =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi
  let match
  while ((match = pattern.exec(sql)) !== null) {
    const [, tableName, body] = match
    const table = registry.tables[tableName] ?? emptyTable(tableName)
    registry.tables[tableName] = table

    for (const part of splitTopLevel(body)) {
      if (/^(constraint|primary\s+key|foreign\s+key|check|unique)\b/i.test(part)) {
        parseConstraint(table, part, registry)
      } else {
        parseColumn(table, part, registry)
      }
    }

    if (table.primaryKey.length === 0 && table.columns.id) table.primaryKey = ["id"]
  }
}

/**
 * ALTER statements must be replayed in source order: 0007 drops a constraint
 * and re-adds it under the same name, so applying every drop after every add
 * would silently erase it.
 */
function applyAlterTable(sql, registry) {
  const patterns = [
    {
      kind: "addColumn",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\s\S]*?);/gi,
    },
    {
      kind: "addConstraint",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+add\s+(constraint[\s\S]*?);/gi,
    },
    {
      kind: "dropConstraint",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+drop\s+constraint\s+(?:if\s+exists\s+)?"?([a-z_0-9]+)"?/gi,
    },
  ]

  const statements = []
  for (const { kind, regex } of patterns) {
    let match
    while ((match = regex.exec(sql)) !== null) {
      statements.push({ kind, at: match.index, table: match[1], payload: match[2] })
    }
  }
  statements.sort((a, b) => a.at - b.at)

  for (const statement of statements) {
    const table = registry.tables[statement.table]
    if (!table) continue

    if (statement.kind === "addColumn") {
      parseColumn(table, statement.payload.trim(), registry)
    } else if (statement.kind === "addConstraint") {
      parseConstraint(table, statement.payload.trim(), registry)
    } else {
      table.checks = table.checks.filter((c) => c.name !== statement.payload)
      if (table.foreignKeys[statement.payload]) {
        delete table.foreignKeys[statement.payload]
        delete registry.relationsByConstraint[statement.payload]
      }
    }
  }
}

function sqlSources() {
  const sources = []
  // t3ckgroup.sql is EXCLUDED on purpose: its own header reads "This schema is
  // for context only and is not meant to be run" — it is a periodically
  // regenerated snapshot for AI context, not an executable source, and it goes
  // stale between regenerations (its sales_opportunities.status inline CHECK
  // still lists the original twelve codes, missing FOR_BIDDING and Payment
  // Verification). Ingesting it duplicated every table-level named constraint
  // under a second, auto-generated `_check` name that no migration ever drops,
  // so the fake DB silently enforced whatever this snapshot happened to say
  // even after 0033+ moved the real schema on. The migrations directory is the
  // only executable, kept-current source of truth.

  const migrations = path.join(REPO_ROOT, "supabase", "migrations")
  if (fs.existsSync(migrations)) {
    for (const file of fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
      sources.push(fs.readFileSync(path.join(migrations, file), "utf8"))
    }
  }
  return sources
}

function build() {
  const registry = { tables: {}, relationsByConstraint: {} }
  for (const source of sqlSources()) {
    const sql = stripComments(source)
    applyCreateTable(sql, registry)
    applyAlterTable(sql, registry)
    applyCreateIndex(sql, registry)
  }
  return registry
}

export const schema = build()

export function getTable(name) {
  return schema.tables[name] ?? null
}

export function getColumn(tableName, columnName) {
  return schema.tables[tableName]?.columns[columnName] ?? null
}

/**
 * Resolves an embedded select target the way PostgREST does.
 *
 * @param {string} fromTable   table the select is rooted at
 * @param {string} targetTable table being embedded
 * @param {string|null} hint   the `!constraint_name` disambiguator, if given
 * @returns {{relation: object, cardinality: "one"|"many"}}
 * @throws  {Error & {pgCode: string}} when the relationship is unknown or ambiguous
 */
export function resolveRelation(fromTable, targetTable, hint) {
  if (hint) {
    const relation = schema.relationsByConstraint[hint]
    if (!relation) {
      throw pgrstError(
        "PGRST200",
        `Could not find a relationship between '${fromTable}' and '${targetTable}' using the hint '${hint}' in the schema cache`,
      )
    }
    if (relation.fromTable === fromTable && relation.toTable === targetTable) {
      return { relation, cardinality: "one" }
    }
    if (relation.fromTable === targetTable && relation.toTable === fromTable) {
      return { relation, cardinality: "many" }
    }
    throw pgrstError(
      "PGRST200",
      `The hint '${hint}' does not describe a relationship between '${fromTable}' and '${targetTable}'`,
    )
  }

  const outgoing = Object.values(schema.tables[fromTable]?.foreignKeys ?? {}).filter(
    (fk) => fk.toTable === targetTable,
  )
  const incoming = Object.values(schema.tables[targetTable]?.foreignKeys ?? {}).filter(
    (fk) => fk.toTable === fromTable,
  )
  const candidates = [
    ...outgoing.map((relation) => ({ relation, cardinality: "one" })),
    ...incoming.map((relation) => ({ relation, cardinality: "many" })),
  ]

  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) {
    throw pgrstError(
      "PGRST200",
      `Could not find a relationship between '${fromTable}' and '${targetTable}' in the schema cache`,
    )
  }
  throw pgrstError(
    "PGRST201",
    `Could not embed because more than one relationship was found for '${fromTable}' and '${targetTable}' — add a !hint to disambiguate`,
  )
}

export function pgrstError(code, message, { status = 400, details = null, hint = null } = {}) {
  const error = new Error(message)
  error.pgrst = { code, message, details, hint }
  error.status = status
  return error
}
