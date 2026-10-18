// Builds the pattern for a "contains this text" match with Odoo's `=ilike` operator.
//
// `=ilike` hands the pattern to Postgres as it is, so `%` and `_` are wildcards and `\` is the
// escape character. Text a person typed has to match literally ("50%" is not "50 and anything"),
// so each of the three is escaped before the surrounding `%` are added.
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
