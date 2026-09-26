/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype. The one-glance summary of
 * an SOR ("Rail + summary" and the three "Summary" layouts):
 * how long it has sat in this Stage, what is still open, and what needs
 * someone's attention. Reads the same queries NowTab does (same keys), so
 * nothing is fetched twice.
 */
import { useQuery } from "@tanstack/react-query";
import { opportunityService } from "../../../../services/opportunityService";
import { currentVisitTaskRows } from "../../../../constants/sorTasks";
import { blockedLabels, formatPHP, itemsTotal, stageMoves, teamRows } from "./shared";

const DAY = 86400000;

export function daysSince(iso) {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

export function useDigest(p) {
  const { opportunity, id, ctx } = p;
  const stageCode = opportunity?.flow_stage_id || opportunity?.status;

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
  const blocked = blockedLabels(p.checklist);
  const { missing } = teamRows(opportunity);
  const days = daysSince(currentVisit?.enteredAt);
  const followUpDue = followUp?.nextDue ? new Date(followUp.nextDue) : null;
  const followUpOverdue = followUpDue && followUpDue < new Date();

  // Ordered by what stops the deal first.
  const attention = [];
  if (ctx.pendingStage) attention.push({ key: "pending", tone: "amber", text: `A move to ${ctx.stageLabel(ctx.pendingStage)} is waiting for your confirmation.`, go: "now" });
  if (p.isRestricted) attention.push({ key: "restricted", tone: "amber", text: "This stage is restricted — the deal can't be moved from here." });
  blocked.forEach((label) => attention.push({ key: `b-${label}`, tone: "amber", text: `Before moving: ${label}`, go: "now" }));
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
