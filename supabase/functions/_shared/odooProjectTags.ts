// Odoo Project tags (#1242): analytic accounts in the "Projects" plan, named after
// one S0. Shared by the IPAS copy and the OPEX Report. Pure maths lives in
// projectTagMath.ts so it can be unit tested.

import { executeKw } from "./odoo.ts";
import { analyticIds, mentionsS0, planColumnFromFields, sharesFromDistribution, type TagShare } from "./projectTagMath.ts";

export * from "./projectTagMath.ts";

type Row = Record<string, unknown>;

export const PROJECTS_PLAN_NAME = "Projects";

/** Analytic account ids -> names. */
export async function analyticNames(uid: number, ids: number[]) {
  const names = new Map<number, string>();
  if (!ids.length) return names;
  const accounts = await executeKw(uid, "account.analytic.account", "read", [ids, ["name"]]);
  for (const a of accounts) names.set(a.id, String(a.name ?? ""));
  return names;
}

/** The id of the "Projects" analytic plan, or null if Odoo has none. */
export async function findProjectsPlanId(uid: number): Promise<number | null> {
  const plans: Row[] = await executeKw(uid, "account.analytic.plan", "search_read", [[["name", "=", PROJECTS_PLAN_NAME]], ["id"]], {
    limit: 1,
  });
  return plans.length ? (plans[0].id as number) : null;
}

/** The account.analytic.line column that holds a plan (x_plan5_id for Projects today). */
export async function analyticLinePlanColumn(uid: number, planId: number): Promise<string | null> {
  const fields = await executeKw(uid, "account.analytic.line", "fields_get", [[]], { attributes: ["type"] });
  return planColumnFromFields(Object.keys(fields ?? {}), planId);
}

/** An S0's Project tags: accounts in the Projects plan whose name starts with the S0 as a whole word. */
export async function findProjectTags(uid: number, s0: string): Promise<{ id: number; name: string }[]> {
  const planId = await findProjectsPlanId(uid);
  if (planId === null) return [];
  const rows: Row[] = await executeKw(uid, "account.analytic.account", "search_read", [
    [["plan_id", "=", planId], ["name", "=ilike", `${s0}%`]],
    ["id", "name"],
  ]);
  // The ilike is a prefix net; whole-word matching decides (S0663 vs S06637).
  return rows
    .filter((r) => mentionsS0(String(r.name ?? "").split(/\s/)[0], s0))
    .map((r) => ({ id: r.id as number, name: String(r.name ?? "") }));
}

/** Shares for P0 lines, keyed by purchase.order.line id. */
export async function sharesForLines(
  uid: number,
  lines: { id: number; analytic_distribution?: unknown }[],
): Promise<Map<number, TagShare[]>> {
  const names = await analyticNames(uid, [...new Set(lines.flatMap((l) => analyticIds(l.analytic_distribution)))]);
  return new Map(lines.map((l) => [l.id, sharesFromDistribution(l.analytic_distribution, names)]));
}

/** Shares for every line of the given P0 numbers, keyed by purchase.order.line id. */
export async function sharesForP0s(uid: number, p0Names: string[]): Promise<Map<number, TagShare[]>> {
  if (!p0Names.length) return new Map();
  const lines: Row[] = await executeKw(uid, "purchase.order.line", "search_read", [
    [["order_id.name", "in", p0Names], ["display_type", "=", false]],
    ["id", "analytic_distribution"],
  ]);
  return sharesForLines(uid, lines as { id: number; analytic_distribution?: unknown }[]);
}

/** P0 lines carrying any of the tag ids. Section and note rows are left out. */
export async function p0LinesForTags(uid: number, tagIds: number[], fields: string[] = []): Promise<Row[]> {
  if (!tagIds.length) return [];
  const want = [...new Set(["id", "order_id", "analytic_distribution", ...fields])];
  const rows: Row[] = await executeKw(uid, "purchase.order.line", "search_read", [
    [["analytic_distribution", "in", tagIds], ["display_type", "=", false]],
    want,
  ]);
  return rows;
}
