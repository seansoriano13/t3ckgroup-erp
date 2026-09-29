// Pure helpers for scripts/seed-release-demo.mjs, kept apart so they can be
// tested without a database.
import { createHash } from "crypto"

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** A stable id for the copy of `id`, so a re-run finds what the last run made. */
export function derivedId(id) {
  const h = createHash("md5").update(`release-demo:${id}`).digest("hex")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Every uuid string anywhere in `value`, jsonb and text included. */
export function collectUuids(value, into = new Set()) {
  if (typeof value === "string") for (const m of value.match(UUID) ?? []) into.add(m.toLowerCase())
  else if (Array.isArray(value)) value.forEach((v) => collectUuids(v, into))
  else if (value && typeof value === "object" && !(value instanceof Date)) Object.values(value).forEach((v) => collectUuids(v, into))
  return into
}

/** `value` with every uuid the map knows swapped, at any depth. */
export function remap(value, map) {
  if (typeof value === "string") return value.replace(UUID, (m) => map.get(m.toLowerCase()) ?? m)
  if (Array.isArray(value)) return value.map((v) => remap(v, map))
  if (value instanceof Date) return value
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v, map)]))
  return value
}
