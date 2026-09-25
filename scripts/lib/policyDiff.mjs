/** Every public policy's name, command and definition, keyed by table + name. */
export const POLICY_SQL = `
  select tablename, policyname, cmd, permissive, roles::text as roles,
         coalesce(qual, '') as qual, coalesce(with_check, '') as with_check
    from pg_policies
   where schemaname = 'public'
   order by tablename, policyname`

const norm = (s) => s.replace(/\s+/g, " ").trim()
const sig = (r) => JSON.stringify([r.cmd, r.permissive, r.roles, norm(r.qual), norm(r.with_check)])
const key = (r) => `${r.tablename}.${r.policyname}`

/** Rows that differ, or exist on one side only. Empty means the sets match. */
export function diffPolicies(prodRows, stagingRows) {
  const prod = new Map(prodRows.map((r) => [key(r), r]))
  const staging = new Map(stagingRows.map((r) => [key(r), r]))
  const out = []
  for (const k of [...new Set([...prod.keys(), ...staging.keys()])].sort()) {
    const p = prod.get(k)
    const s = staging.get(k)
    if (!p) out.push({ policy: k, kind: "only on staging" })
    else if (!s) out.push({ policy: k, kind: "only on production" })
    else if (sig(p) !== sig(s)) out.push({ policy: k, kind: "differs", prod: p, staging: s })
  }
  return out
}
