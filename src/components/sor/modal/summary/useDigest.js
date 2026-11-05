/**
 * SOR modal layout. The one-glance summary of
 * an SOR ("Rail + summary" and the three "Summary" layouts):
 * how long it has sat in this Stage, what is still open, and what needs
 * someone's attention. Reads the same queries NowTab does (same keys), so
 * nothing is fetched twice.
 */
import { useQuery } from "@tanstack/react-query";
import { opportunityService } from "../../../../services/opportunityService";
import { currentVisitTaskRows } from "../../../../constants/sorTasks";
import { COSTING_BAND } from "../../../../constants/costing";
import { useCostingMatrix } from "../../../costing/useCostingMatrix";
import { blockedLabels, formatPHP, itemsTotal, stageMoves, teamRows } from "./shared";

const DAY = 86400000;

export function daysSince(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

/**
 * #901: each Stage Action waiting on this viewer's Create or Skip becomes a
 * Needs attention row, so the Summary no longer says "Nothing needs attention"
 * while the decision card sits on the Now tab. Failed runs also wait here.
 */
export function pendingDecisionAttention(runs = []) {
  return runs.map((run) => {
    const title = run.title || "A Stage Action";
    return {
      key: `decision-${run.runId}`,
      tone: "amber",
      text: run.failed ? `${title} failed. Press Create to try again.` : `${title} is waiting for your Create or Skip.`,
      go: "now",
    };
  });
}

/**
 * The "Name a Technical in-charge" attention item (#910). Shown only when the SOR has an S0 Evaluation
 * with no Technical in-charge, and only to a caller who can name one (the Sales or Purchasing band).
 * `matrix` is the shaped Costing Matrix (`costingMatrixService.get`), or null when the caller has no
 * tier or the SOR has no matrix yet.
 */
export function technicalInchargeAttention(matrix) {
  if (!matrix?.matrix) return null;
  if (matrix.matrix.technical_incharge_id) return null;
  const canName = (matrix.bands ?? []).some((band) => band === COSTING_BAND.SALES || band === COSTING_BAND.PURCHASING);
  if (!canName) return null;
  return { key: "technical", tone: "amber", text: "Name a Technical in-charge for the S0 Evaluation.", go: "pms" };
}

export function useDigest(p) {
  const { opportunity, id, ctx } = p;
  const stageCode = opportunity?.flow_stage_id || opportunity?.status;
  const actorId = ctx?.user?.id;

  // Same key as PendingActionDecisions, so the Now tab's card and this row refresh together.
  const { data: pendingDecisions = [] } = useQuery({
    queryKey: ["pendingActionDecisions", opportunity?.id, actorId],
    queryFn: () => opportunityService.getPendingActionsForActor(opportunity.id, actorId),
    enabled: !!opportunity?.id && !!actorId,
  });
  // Shared with the PMS tab (same key), so the Costing Matrix is not fetched twice.
  const { data: costingMatrix = null } = useCostingMatrix(id);

  const { data: currentVisit = null } = useQuery({
    queryKey: ["currentStageVisit", id, stageCode],
    queryFn: () => opportunityService.getCurrentStageVisit(id),
    enabled: !!id,
  });
  const { data: followUp = null } = useQuery({
    queryKey: ["followUpStatus", id, stageCode],
    queryFn: () => opportunityService.getFollowUpStatus(id),
    enabled: !!id,
  });

  const moves = stageMoves(p);
  const taskRows = currentVisitTaskRows(ctx.automationTasks, currentVisit);
  const openTasks = taskRows.filter((r) => r.totalCount === 0 || r.doneCount < r.totalCount);
  const overdueTasks = openTasks.filter((r) => r.dueDate && new Date(r.dueDate) < new Date());
  const blocked = blockedLabels(p.checklist, p.missingRequiredStageFields);
  const { missing } = teamRows(opportunity);
  const days = daysSince(currentVisit?.enteredAt);
  const followUpDue = followUp?.nextDue ? new Date(followUp.nextDue) : null;
  const followUpOverdue = followUpDue && followUpDue < new Date();

  // Ordered by what stops the deal first.
  const attention = [];
  if (ctx.pendingStage) attention.push({ key: "pending", tone: "amber", text: `A move to ${ctx.stageLabel(ctx.pendingStage)} is waiting for your confirmation.`, go: "now" });
  if (p.isRestricted) attention.push({ key: "restricted", tone: "amber", text: "This stage is restricted — the deal can't be moved from here." });
  blocked.forEach((label) => attention.push({ key: `b-${label}`, tone: "amber", text: `Before moving: ${label}`, go: "now" }));
  attention.push(...pendingDecisionAttention(pendingDecisions));
  const inchargeItem = technicalInchargeAttention(costingMatrix);
  if (inchargeItem) attention.push(inchargeItem);
  if (followUpOverdue) attention.push({ key: "followup", tone: "red", text: "Follow-up is overdue.", go: "now" });
  if (overdueTasks.length) attention.push({ key: "overdue", tone: "red", text: `${overdueTasks.length} task${overdueTasks.length === 1 ? " is" : "s are"} past due.`, go: "now" });
  if (!opportunity.sales_reference && opportunity.status === "LEAD" && !p.isFlowDeal) attention.push({ key: "ref", tone: "amber", text: "No Sales Reference yet — needed to qualify.", go: "details" });
  if (missing.length) attention.push({ key: "team", tone: "mauve", text: `Unassigned: ${missing.join(", ")} (commission stays unattributed).`, go: "details" });
  if (ctx.items.length === 0 && !ctx.itemsLoading && opportunity.sales_reference) attention.push({ key: "items", tone: "mauve", text: "No products pulled from Odoo yet.", go: "items" });

  return {
    moves,
    currentVisit,
    days,
    followUp,
    followUpDue,
    followUpOverdue,
    taskRows,
    openTasks,
    overdueTasks,
    blocked,
    attention,
    itemsCount: ctx.items.length,
    itemsTotal: formatPHP(itemsTotal(ctx.items)),
    latestNote: p.notes[p.notes.length - 1] || null,
  };
}
