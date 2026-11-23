// Pure helpers for scripts/db-query.mjs: refuse SQL that could leave the
// read-only transaction, and print results as short psql-style tables.

/** SQL with comments and quoted text blanked, so keywords inside them don't count. */
export function stripSqlNoise(sql) {
  return sql
    .replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
}

const STATEMENT_START =
  /(?:^|;)\s*(begin|commit|rollback|abort|end|start\s+transaction|savepoint|release|prepare\s+transaction)\b/i
const READ_ONLY_SWITCH =
  /\b(default_transaction_read_only|transaction_read_only|session\s+characteristics|set\s+(?:local\s+|session\s+)?role|session\s+authorization)\b/i

/** Why this SQL is refused, or null when it may run. */
export function refuseReason(sql) {
  const plain = stripSqlNoise(sql)
  if (!plain.replace(/;/g, "").trim()) return "There is no SQL to run."
  const start = plain.match(STATEMENT_START)
  if (start) return `"${start[1].toUpperCase()}" would end the read-only transaction, so the SQL is refused.`
  const toggle = plain.match(READ_ONLY_SWITCH)
  if (toggle) return `"${toggle[1]}" could switch off read-only mode, so the SQL is refused.`
  return null
}

/** One value as table text. */
export function cell(value) {
  if (value === null || value === undefined) return "null"
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`
  if (typeof value === "object") return JSON.stringify(value)
  return String(value).replace(/\r?\n/g, "\\n")
}

/** A result as a psql-style table: header, rule, rows, then the row count. */
export function formatTable(columns, rows, { limit = 100, wide = false } = {}) {
  const cut = (text) => (wide || text.length <= 60 ? text : `${text.slice(0, 59)}…`)
  const shown = rows.slice(0, limit).map((row) => row.map((value) => cut(cell(value))))
  const widths = columns.map((name, i) => Math.max(name.length, ...shown.map((row) => row[i].length)))
  const line = (values) => values.map((v, i) => v.padEnd(widths[i])).join(" | ").trimEnd()
  const count = rows.length === 1 ? "(1 row)" : `(${rows.length} rows)`
  const more = rows.length > limit ? `, showing the first ${limit}; use --limit to see more` : ""
  return [line(columns), widths.map((w) => "-".repeat(w)).join("-+-"), ...shown.map(line), `${count}${more}`].join("\n")
}

/** A result as one JSON object per row; a repeated column name gets _2, _3. */
export function formatJson(columns, rows, { limit = 100 } = {}) {
  const keys = columns.map((name, i) => {
    const before = columns.slice(0, i).filter((n) => n === name).length
    return before ? `${name}_${before + 1}` : name
  })
  return rows
    .slice(0, limit)
    .map((row) => JSON.stringify(Object.fromEntries(keys.map((key, i) => [key, row[i]]))))
    .join("\n")
}

/** A quoted SQL string literal. */
export function literal(text) {
  return `'${String(text).replace(/'/g, "''")}'`
}
