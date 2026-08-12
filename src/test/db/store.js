/**
 * The in-memory database the MSW PostgREST handler serves from.
 *
 * It enforces the constraints the parsed schema knows about — NOT NULL, primary
 * key and UNIQUE, CHECK enums and comparisons, and foreign keys — so a write
 * that Postgres would reject is rejected here too, with the same SQLSTATE. A
 * service test that passes against this store is a service test that has
 * satisfied the real table's contract.
 *
 * Volatile defaults are deterministic. `gen_random_uuid()` counts up from a
 * fixed prefix and `now()` advances the store clock by one millisecond per
 * call, so ids and created_at ordering are identical on every run.
 */

import { getTable, pgrstError, schema } from "./schema"
import { resetSequences, runAfterWrite, runBeforeInsert, runBeforeUpdate } from "./triggers"

const state = {
  tables: new Map(),
  uuidCounter: 0,
  identityCounters: new Map(),
  clock: Date.now(),
}

function nextUuid() {
  state.uuidCounter += 1
  return `00000000-0000-4000-8000-${String(state.uuidCounter).padStart(12, "0")}`
}

function nextTimestamp() {
  state.clock += 1
  return new Date(state.clock).toISOString()
}

function nextIdentity(table, column) {
  const key = `${table}.${column}`
  const value = (state.identityCounters.get(key) ?? 0) + 1
  state.identityCounters.set(key, value)
  return value
}

function rowsOf(tableName) {
  if (!state.tables.has(tableName)) state.tables.set(tableName, [])
  return state.tables.get(tableName)
}

function requireTable(tableName) {
  const table = getTable(tableName)
  if (!table) {
    throw pgrstError("42P01", `relation "public.${tableName}" does not exist`, { status: 404 })
  }
  return table
}

/** Casts an incoming JSON value to what the column's Postgres type would hold. */
export function coerceValue(column, value) {
  if (value == null) return null
  switch (column.type) {
    case "number": {
      const n = Number(value)
      return Number.isNaN(n) ? value : n
    }
    case "boolean":
      if (typeof value === "boolean") return value
      return value === "true" || value === "t" || value === true
    case "array":
      return Array.isArray(value) ? value : [value]
    default:
      return value
  }
}

function applyDefaults(tableName, table, row) {
  const result = { ...row }
  for (const column of Object.values(table.columns)) {
    if (result[column.name] !== undefined) continue
    const def = column.default
    if (!def) {
      result[column.name] = null
      continue
    }
    if (def.kind === "uuid") result[column.name] = nextUuid()
    else if (def.kind === "now") result[column.name] = nextTimestamp()
    else if (def.kind === "today") result[column.name] = nextTimestamp().slice(0, 10)
    else if (def.kind === "identity") result[column.name] = nextIdentity(tableName, column.name)
    else result[column.name] = Array.isArray(def.value) ? [...def.value] : def.value
  }
  return result
}

function rejectUnknownColumns(tableName, table, row) {
  for (const key of Object.keys(row)) {
    if (!table.columns[key]) {
      throw pgrstError(
        "PGRST204",
        `Could not find the '${key}' column of '${tableName}' in the schema cache`,
        { status: 400 },
      )
    }
  }
}

function checkNotNull(tableName, table, row) {
  for (const column of Object.values(table.columns)) {
    if (column.notNull && row[column.name] == null) {
      throw pgrstError(
        "23502",
        `null value in column "${column.name}" of relation "${tableName}" violates not-null constraint`,
        { status: 400, details: `Failing row contains ${JSON.stringify(row)}.` },
      )
    }
  }
}

function checkConstraints(tableName, table, row) {
  for (const check of table.checks) {
    const value = row[check.column]
    if (value == null) continue

    if (check.kind === "enum" && !check.values.includes(value)) {
      throw pgrstError(
        "23514",
        `new row for relation "${tableName}" violates check constraint "${check.name}"`,
        {
          status: 400,
          details: `Failing row has ${check.column} = "${value}"; allowed: ${check.values.join(", ")}.`,
        },
      )
    }

    if (check.kind === "comparison") {
      const n = Number(value)
      const passes =
        (check.operator === ">" && n > check.value) ||
        (check.operator === ">=" && n >= check.value) ||
        (check.operator === "<" && n < check.value) ||
        (check.operator === "<=" && n <= check.value)
      if (!passes) {
        throw pgrstError(
          "23514",
          `new row for relation "${tableName}" violates check constraint "${check.name}"`,
          { status: 400, details: `Failing row has ${check.column} = ${value}.` },
        )
      }
    }
  }
}

function keyOf(row, columns) {
  return columns.map((c) => JSON.stringify(row[c] ?? null)).join("|")
}

function checkUnique(tableName, table, row, existingRow) {
  const groups = [
    ...(table.primaryKey.length ? [{ columns: table.primaryKey, name: `${tableName}_pkey` }] : []),
    ...table.unique.map((columns) => ({ columns, name: `${tableName}_${columns.join("_")}_key` })),
  ]

  for (const group of groups) {
    if (group.columns.some((c) => row[c] == null)) continue
    const key = keyOf(row, group.columns)
    const clash = rowsOf(tableName).some(
      (other) => other !== existingRow && keyOf(other, group.columns) === key,
    )
    if (clash) {
      throw pgrstError(
        "23505",
        `duplicate key value violates unique constraint "${group.name}"`,
        { status: 409, details: `Key (${group.columns.join(", ")})=(${group.columns.map((c) => row[c]).join(", ")}) already exists.` },
      )
    }
  }
}

function checkForeignKeys(tableName, table, row) {
  for (const fk of Object.values(table.foreignKeys)) {
    const value = row[fk.fromColumn]
    if (value == null) continue
    const referenced = rowsOf(fk.toTable).some((other) => other[fk.toColumn] === value)
    if (!referenced) {
      throw pgrstError(
        "23503",
        `insert or update on table "${tableName}" violates foreign key constraint "${fk.constraint}"`,
        {
          status: 409,
          details: `Key (${fk.fromColumn})=(${value}) is not present in table "${fk.toTable}".`,
        },
      )
    }
  }
}

function normalise(table, row) {
  const result = {}
  for (const [key, value] of Object.entries(row)) {
    const column = table.columns[key]
    result[key] = column ? coerceValue(column, value) : value
  }
  return result
}

/** Inserts one row, running every constraint the schema declares. */
export function insertRow(tableName, input) {
  const table = requireTable(tableName)
  rejectUnknownColumns(tableName, table, input)

  const row = normalise(table, applyDefaults(tableName, table, input))
  runBeforeInsert(tableName, row)
  checkNotNull(tableName, table, row)
  checkConstraints(tableName, table, row)
  checkUnique(tableName, table, row, null)
  checkForeignKeys(tableName, table, row)

  rowsOf(tableName).push(row)
  runAfterWrite(tableName, row, null, { rowsOf })
  return { ...row }
}

/** Applies a partial patch to an already-stored row, re-validating the result. */
export function updateRow(tableName, existingRow, patch) {
  const table = requireTable(tableName)
  rejectUnknownColumns(tableName, table, patch)

  const previous = { ...existingRow }
  const merged = { ...existingRow, ...normalise(table, patch) }
  runBeforeUpdate(tableName, merged, previous)
  checkNotNull(tableName, table, merged)
  checkConstraints(tableName, table, merged)
  checkUnique(tableName, table, merged, existingRow)
  checkForeignKeys(tableName, table, merged)

  Object.assign(existingRow, merged)
  runAfterWrite(tableName, existingRow, previous, { rowsOf })
  return { ...existingRow }
}

export function deleteRows(tableName, targets) {
  requireTable(tableName)
  const rows = rowsOf(tableName)
  const removed = []
  for (const target of targets) {
    const index = rows.indexOf(target)
    if (index !== -1) removed.push(...rows.splice(index, 1))
  }
  const copies = removed.map((row) => ({ ...row }))
  for (const row of copies) runAfterWrite(tableName, row, row, { rowsOf })
  return copies
}

export const db = {
  /**
   * Inserts rows for test setup. Same validation as a real write, so a fixture
   * that could not exist in production fails at seed time instead of producing
   * a green test against impossible data.
   */
  seed(tableName, rows) {
    const list = Array.isArray(rows) ? rows : [rows]
    const inserted = list.map((row) => insertRow(tableName, row))
    return Array.isArray(rows) ? inserted : inserted[0]
  },

  /** Live rows for a table. Read-only in spirit — assert through services. */
  rows(tableName) {
    requireTable(tableName)
    return rowsOf(tableName).map((row) => ({ ...row }))
  },

  /**
   * Starts each test from an empty database and a clock set to now.
   *
   * The clock tracks wall time rather than a fixed epoch on purpose: services
   * compare a stored `created_at` against `Date.now()` (the activity timeline
   * folds repeated events inside a two-hour window), and a store frozen in the
   * past would put every row months out of range. Determinism comes from the
   * clock only ever advancing one millisecond per default, so ordering is
   * identical run to run; use `setClock()` where the literal value matters.
   */
  reset() {
    state.tables = new Map()
    state.uuidCounter = 0
    state.identityCounters = new Map()
    state.clock = Date.now()
    resetSequences()
  },

  /** Pins the clock so timestamp-sensitive assertions can use a known value. */
  setClock(isoString) {
    state.clock = new Date(isoString).getTime()
  },

  nextUuid,
  tableNames: () => Object.keys(schema.tables),
  internal: { rowsOf, requireTable },
}
