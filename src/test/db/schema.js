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
 *   - ALTER TABLE   → ADD COLUMN, ADD CONSTRAINT, DROP CONSTRAINT, ALTER COLUMN SET DEFAULT
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

  // The literal may be bare (hand-written migrations: `hours > 0`) or wrapped
  // in a paren + cast the way pg_get_constraintdef() canonicalizes it when a
  // constraint is read back from a live database: `hours > (0)::numeric`.
  const comparison = expr.match(/\(?\s*([a-z_0-9]+)\s*(>=|<=|>|<)\s*\(?\s*(-?[\d.]+)\s*\)?(?:::[a-z_ ]+)?/)
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
    uniqueByName: {},
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
    const cols = unique[1].split(",").map((c) => c.trim().replace(/"/g, ""))
    table.unique.push(cols)
    // Remember the column set under the constraint name so a later
    // `drop constraint` can find and remove it — Postgres drops a UNIQUE by
    // name, and without this the harness could only ever add them.
    ;(table.uniqueByName ||= {})[name] = cols
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
  // `using btree` (etc.) is optional in hand-written migrations but always
  // present in indexdef as read back from a live database (pg_indexes),
  // e.g. `CREATE UNIQUE INDEX x ON public.t USING btree (col)`.
  const head = /create\s+unique\s+index(?:\s+concurrently)?(?:\s+if\s+not\s+exists)?\s+"?([a-z_0-9]+)"?\s+on\s+(?:public\.)?"?([a-z_0-9]+)"?\s*(?:using\s+\w+\s*)?/gi
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

    // A key list of column names dedupes on those columns. A key list that
    // mentions no column at all is an expression over constants — `((true))` —
    // where every row the predicate selects shares one key, which is how "at
    // most one row may set this flag" is spelled.
    //
    // A key list that references columns but is not a bare list of them is an
    // expression this harness cannot evaluate — `lower(btrim(name))`, say.
    // Treating that as a constant would collapse every row onto one key and
    // make the table hold a single row, so it is left UNENFORCED instead, the
    // same way an unrecognised CHECK or index predicate is. A service that
    // needs the guarantee tested has to assert it where it enforces it.
    const parts = keyBody.split(",").map((c) => c.trim().replace(/"/g, ""))
    const columns = parts.every((c) => table.columns[c]) ? parts : null
    if (columns === null && Object.keys(table.columns).some((c) => new RegExp(`\\b${c}\\b`).test(keyBody))) {
      continue
    }

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

function applyDropTable(sql, registry) {
  const pattern = /drop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*(?:cascade)?\s*;/gi
  let match
  while ((match = pattern.exec(sql)) !== null) {
    const tableName = match[1]
    delete registry.tables[tableName]
    // Also remove any relations that point from this table
    for (const [constraintName, relation] of Object.entries(registry.relationsByConstraint)) {
      if (relation.fromTable === tableName) {
        delete registry.relationsByConstraint[constraintName]
      }
    }
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
    {
      kind: "setDefault",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+alter\s+column\s+"?([a-z_0-9]+)"?\s+set\s+default\s+([^;]+);/gi,
    },
    {
      kind: "renameTable",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+rename\s+to\s+"?([a-z_0-9]+)"?\s*;/gi,
    },
    {
      kind: "renameColumn",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+rename\s+column\s+"?([a-z_0-9]+)"?\s+to\s+"?([a-z_0-9]+)"?\s*;/gi,
    },
    {
      kind: "renameConstraint",
      regex:
        /alter\s+table\s+(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+rename\s+constraint\s+"?([a-z_0-9]+)"?\s+to\s+"?([a-z_0-9]+)"?\s*;/gi,
    },
  ]

  const statements = []
  for (const { kind, regex } of patterns) {
    let match
    while ((match = regex.exec(sql)) !== null) {
      statements.push({ kind, at: match.index, table: match[1], payload: match[2], extra: match[3] })
    }
  }
  statements.sort((a, b) => a.at - b.at)

  for (const statement of statements) {
    const table = registry.tables[statement.table]
    if (!table) continue

    if (statement.kind === "addColumn") {
      // `add column a …, add column b …` is one statement: each clause is its
      // own column (20261005130200 adds two to purchase_requests this way).
      splitTopLevel(statement.payload).forEach((clause, i) => {
        const addColumn = /^add\s+column\s+(?:if\s+not\s+exists\s+)?/i
        if (i > 0 && !addColumn.test(clause)) return
        parseColumn(table, clause.replace(addColumn, "").trim(), registry)
      })
    } else if (statement.kind === "addConstraint") {
      parseConstraint(table, statement.payload.trim(), registry)
    } else if (statement.kind === "dropConstraint") {
      table.checks = table.checks.filter((c) => c.name !== statement.payload)
      if (table.foreignKeys[statement.payload]) {
        delete table.foreignKeys[statement.payload]
        delete registry.relationsByConstraint[statement.payload]
      }
      const droppedUnique = table.uniqueByName?.[statement.payload]
      if (droppedUnique) {
        // Remove every entry with these columns: `create table if not exists`
        // is replayed across migrations, so the same UNIQUE can sit in the
        // list more than once.
        const key = droppedUnique.join(",")
        table.unique = table.unique.filter((cols) => cols.join(",") !== key)
        delete table.uniqueByName[statement.payload]
      }
    } else if (statement.kind === "setDefault") {
      if (table.columns[statement.payload]) table.columns[statement.payload].default = parseDefault(statement.extra.trim())
    } else if (statement.kind === "renameTable") {
      const newTableName = statement.payload
      registry.tables[newTableName] = table
      delete registry.tables[statement.table]
      
      for (const relation of Object.values(registry.relationsByConstraint)) {
        if (relation.toTable === statement.table) relation.toTable = newTableName
        if (relation.fromTable === statement.table) relation.fromTable = newTableName
      }
    } else if (statement.kind === "renameColumn") {
      const oldCol = statement.payload
      const newCol = statement.extra
      if (table.columns[oldCol]) {
        table.columns[newCol] = table.columns[oldCol]
        table.columns[newCol].name = newCol
        delete table.columns[oldCol]
        
        table.primaryKey = table.primaryKey.map(c => c === oldCol ? newCol : c)
        table.unique = table.unique.map(cols => cols.map(c => c === oldCol ? newCol : c))
      }
    } else if (statement.kind === "renameConstraint") {
      const oldConst = statement.payload
      const newConst = statement.extra
      if (table.foreignKeys[oldConst]) {
        table.foreignKeys[newConst] = table.foreignKeys[oldConst]
        table.foreignKeys[newConst].constraint = newConst
        delete table.foreignKeys[oldConst]
        registry.relationsByConstraint[newConst] = registry.relationsByConstraint[oldConst]
        delete registry.relationsByConstraint[oldConst]
      }
      for (const check of table.checks) {
        if (check.name === oldConst) check.name = newConst
      }
    }
  }
}

/**
 * All sources are now `supabase/migrations/*.sql`, in filename order — the
 * baseline migration (issue #87, `20260904000000_baseline_schema.sql`) means
 * the files alone build the full schema, so the schema mirror this parser
 * used to lean on as a starting point (supabase/schema/staging.sql) is no
 * longer needed as a base. That mirror is generated (pnpm db:snapshot:staging)
 * and stays read-only reference/drift-detection material — see AGENTS.md
 * § Database migrations — never a source this parser reads.
 *
 * t3ckgroup.sql at the repo root is EXCLUDED on purpose: its own header reads
 * "This schema is for context only and is not meant to be run" — it is a
 * periodically regenerated snapshot for AI context, not an executable
 * source, and it goes stale between regenerations (its
 * sales_opportunities.status inline CHECK still lists the original twelve
 * codes, missing FOR_BIDDING and Payment Verification). Ingesting it
 * duplicated every table-level named constraint under a second,
 * auto-generated `_check` name that no migration ever drops, so the fake DB
 * silently enforced whatever this snapshot happened to say even after 0033+
 * moved the real schema on.
 *
 * The baseline migration additionally carries Functions, RLS and Triggers
 * sections (it is generated from a schema mirror — see docs/adr/0011), whose
 * bodies are dollar-quoted (`$function$ ... $function$`) and can embed their
 * own parentheses, commas and semicolons. Nothing in this file's parser
 * understands dollar-quoting — it only tracks single-quoted strings and paren
 * depth — so feeding it a function body would corrupt statement splitting for
 * everything after it. `truncateBeforeFunctions` drops a source at its first
 * `-- Functions` section marker, the same cut the parser used to make against
 * the schema mirror directly; an ordinary hand-written migration has no such
 * marker and passes through whole.
 */
function truncateBeforeFunctions(sql) {
  const marker = sql.indexOf("-- Functions\n")
  return marker === -1 ? sql : sql.slice(0, marker)
}

function sqlSources() {
  const sources = []

  const migrations = path.join(REPO_ROOT, "supabase", "migrations")
  if (fs.existsSync(migrations)) {
    for (const file of fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
      sources.push(truncateBeforeFunctions(fs.readFileSync(path.join(migrations, file), "utf8")))
    }
  }
  return sources
}

function build() {
  const registry = { tables: {}, relationsByConstraint: {} }
  for (const source of sqlSources()) {
    const sql = stripComments(source)
    applyDropTable(sql, registry)
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
