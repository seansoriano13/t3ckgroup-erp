// Pure parts of the Odoo Project-tag helper (#1242). No Odoo or Deno access, so
// src/utils/projectTagMath.test.js can import this file directly.
// A Project tag is an analytic account in Odoo's "Projects" plan, named after one S0.

export type TagShare = {
  tagId: number;
  tagName: string;
  /** The S0 number read from the tag name, e.g. "S06637", or null. */
  s0: string | null;
  percent: number;
};

/** One distribution key ("273" or "273,15") -> the account ids it joins. */
export function parseDistributionKey(key: string): number[] {
  const ids: number[] = [];
  for (const part of String(key).split(",")) {
    const id = Number(part);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

/**
 * `analytic_distribution` is `{ "<id>[,<id>...]": percent }`: a key may join
 * several analytic accounts, one per plan. Returns every account id mentioned.
 */
export function analyticIds(distribution: unknown): number[] {
  if (!distribution || typeof distribution !== "object") return [];
  const ids = new Set<number>();
  for (const key of Object.keys(distribution as Record<string, unknown>)) {
    for (const id of parseDistributionKey(key)) ids.add(id);
  }
  return [...ids];
}

/** The S0 number a tag name starts with ("S06637 DRR ..." -> "S06637"), or null. */
export function s0FromTagName(name: unknown): string | null {
  const m = /^\s*(S\d+)(?![A-Za-z0-9])/i.exec(String(name ?? ""));
  return m ? m[1].toUpperCase() : null;
}

/** True when `s0` appears in `text` as a whole word: S0663 never matches "S06637 ...". */
export function mentionsS0(text: unknown, s0: unknown): boolean {
  const want = String(s0 ?? "").trim();
  if (!/^S\d+$/i.test(want)) return false;
  return new RegExp(`(^|[^A-Za-z0-9])${want}(?![A-Za-z0-9])`, "i").test(String(text ?? ""));
}

/**
 * Every account in a line's distribution as a share. A key's percent applies to
 * each account the key joins; an account in several keys adds up.
 */
export function sharesFromDistribution(distribution: unknown, names: Map<number, string>): TagShare[] {
  if (!distribution || typeof distribution !== "object") return [];
  const byId = new Map<number, number>();
  for (const [key, pct] of Object.entries(distribution as Record<string, unknown>)) {
    const percent = Number(pct) || 0;
    for (const id of parseDistributionKey(key)) byId.set(id, (byId.get(id) ?? 0) + percent);
  }
  return [...byId].map(([tagId, percent]) => {
    const tagName = names.get(tagId) ?? "";
    return { tagId, tagName, s0: s0FromTagName(tagName), percent };
  });
}

/** Percent of a line that belongs to one S0 (0 when none of its tags name it). */
export function percentForS0(shares: TagShare[], s0: string): number {
  const want = s0.trim().toUpperCase();
  return shares.filter((s) => s.s0 === want).reduce((sum, s) => sum + s.percent, 0);
}

/**
 * The account.analytic.line column holding a plan. Odoo keeps custom plans in
 * `x_plan<id>_id` and the first plan in `account_id`.
 */
export function planColumnFromFields(fieldNames: string[], planId: number): string | null {
  const custom = `x_plan${planId}_id`;
  if (fieldNames.includes(custom)) return custom;
  return fieldNames.includes("account_id") ? "account_id" : null;
}
