/**
 * One row shape for every Approval Center queue.
 *
 * Task Approvals, HR Verifications and Leave & Overtime look identical on
 * screen, so their records are flattened into one `ApprovalItem` before they
 * reach the table or the review sheet. The original record rides along as
 * `source`: the decision handlers write back through it, never through the item.
 *
 * Everything here is pure. `now` is injectable so a test can pin the clock.
 */

import { TASK_STATUS } from "../constants/status.js";
import { IPAS_PRIORITY, IPAS_SIGNOFF_ROLE_LABELS, ipasSectionLabel } from "../constants/ipas.js";
import { TRANSMITTAL_ORIGIN_LABELS, TRANSMITTAL_PRIORITY } from "../constants/transmittals.js";
import { checklistProgressLabel, isChecklistDescription, isStaleSince } from "./approvalQueue.js";

export const LEAVE_LABEL = { SIL: "SIL Leave", OFFSET: "Offset", OVERTIME: "Overtime", UNDERTIME: "Undertime" };
const LEAVE_REF = { SIL: "SIL", OFFSET: "OFS", OVERTIME: "OT", UNDERTIME: "UT" };

/** A short, stable, human-readable handle for a record: `TSK-3F2A1`. */
export function shortRef(prefix, id) {
    const tail = String(id ?? "").replace(/[^a-z0-9]/gi, "").slice(-5).toUpperCase();
    return `${prefix}-${tail || "?"}`;
}

/** First line of a task's prose, or the checklist's progress when it is one. */
export function taskHeadline(task) {
    if (task?.projectTitle) return task.projectTitle;
    const desc = task?.taskDescription;
    if (isChecklistDescription(desc)) return `Checklist · ${checklistProgressLabel(desc) ?? "0/0"}`;
    const line = String(desc || "").split("\n").find((l) => l.trim()) || "";
    return line.trim() || task?.categoryId || "Task";
}

/**
 * The approval chain as the reviewer should read it: who has acted, whose turn
 * it is, who is next. Only steps the system actually has — no invented payroll
 * stage — so a task is Logged → Head grade → HR verification, and a leave is
 * Requested → Department head → HR approval.
 */
export function taskChain(task) {
    const graded = task?.status === TASK_STATUS.COMPLETE && task?.evaluatedById != null;
    return [
        { label: "Logged", who: task?.loggedByName || "Employee", state: "done", at: task?.createdAt || null },
        {
            label: "Head grade",
            who: graded ? task?.evaluatedByName || "Head" : task?.reportedToName || "Department head",
            state: graded ? "done" : "current",
            at: graded ? task?.evaluatedAt || null : null,
            note: graded && task?.grade ? `Grade ${task.grade}/5` : null,
        },
        {
            label: "HR verification",
            who: "HR",
            state: task?.hrVerified ? "done" : graded ? "current" : "next",
            at: task?.hrVerifiedAt || null,
        },
    ];
}

export function leaveChain(request) {
    return [
        { label: "Requested", who: request?.employee?.name || "Employee", state: "done", at: request?.created_at || null },
        { label: "Department head", who: "You", state: "current", at: null },
        { label: "HR approval", who: "HR", state: "next", at: null },
    ];
}

/**
 * IPAS sign-offs: sections 1 and 3 are Prepared by Purchasing, then wait on this
 * approver; section 7 is Received, Noted and Checked, then Approved, and the
 * chain shows who has given each and which one is this person's.
 */
export function ipasChain(pending) {
    if (pending?.section === 7 && Array.isArray(pending.steps)) {
        return pending.steps.map((step) => {
            if (step.signoff) {
                return { label: step.label, who: step.signoff.signedBy?.name || "Someone", state: "done", at: step.signoff.signedAt || null };
            }
            if (step.role === pending.role) return { label: step.label, who: "You", state: "current", at: null };
            return { label: step.label, who: `Section ${ipasSectionLabel(7)} list`, state: "next", at: null };
        });
    }
    return [
        { label: "Prepared", who: pending?.preparedBy?.name || "Purchasing", state: "done", at: pending?.preparedAt || null },
        { label: "Approved", who: "You", state: "current", at: null },
    ];
}

/**
 * An IPAS section waiting on the signed-in approver (ipasService.pendingSignoffsFor)
 * as an ApprovalItem. The clock runs from when it became ready for this person
 * (Purchasing prepared the section; for section 7, the sign-off before theirs),
 * and the "person" is whoever did that. A very high priority IPAS reads as high
 * priority.
 */
export function ipasToItem(pending, now = Date.now()) {
    const clockAt = pending.readyAt ?? pending.preparedAt;
    return {
        id: pending.id,
        queue: "ipas",
        ref: pending.number,
        title: pending.supplier || pending.poNumber,
        typeLabel: `${pending.poNumber} · Section ${ipasSectionLabel(pending.section)}${pending.section === 7 ? ` · ${IPAS_SIGNOFF_ROLE_LABELS[pending.role] ?? pending.role}` : ""}`,
        person: {
            id: pending.preparedBy?.id,
            name: pending.preparedBy?.name || "Unknown",
            avatarPath: pending.preparedBy?.avatarPath || null,
            dept: pending.section === 7 ? "Filing" : "Purchasing",
        },
        submittedAt: clockAt,
        clockAt,
        isStale: isStaleSince(clockAt, now),
        done: false,
        isHighPriority: pending.priority === IPAS_PRIORITY.VERY_HIGH,
        attachmentCount: 0,
        chain: ipasChain(pending),
        source: pending,
    };
}

/**
 * A task as an ApprovalItem. `queue` is "tasks" (the head grades it) or "hr"
 * (HR signs it off); the HR clock runs from the grade, the head's from logging.
 */
export function taskToItem(task, queue, now = Date.now()) {
    const done = queue === "hr" ? !!task.hrVerified : task.status === TASK_STATUS.COMPLETE;
    const clockAt = queue === "hr" ? task.evaluatedAt || task.createdAt : task.createdAt;
    return {
        id: task.id,
        queue,
        ref: shortRef("TSK", task.id),
        title: taskHeadline(task),
        typeLabel: task.categoryId || "Task",
        person: {
            id: task.loggedById,
            name: task.loggedByName || "Unknown",
            avatarPath: task.loggedByAvatar || null,
            dept: task.subDepartment || task.sub_department || task.creator?.sub_department || task.creator?.department || "",
        },
        submittedAt: task.createdAt,
        clockAt,
        isStale: !done && isStaleSince(clockAt, now),
        done,
        isHighPriority: task.priority === "HIGH",
        attachmentCount: task.attachments?.length || 0,
        chain: taskChain(task),
        source: task,
    };
}

export function leaveToItem(request, now = Date.now()) {
    const e = request.employee || {};
    const clockAt = request.created_at || request.date;
    return {
        id: `${request.table}:${request.matchValue}:${request.id}`,
        queue: "leaves",
        ref: shortRef(LEAVE_REF[request.requestType] || "REQ", request.id),
        title: LEAVE_LABEL[request.requestType] || request.requestType,
        typeLabel: LEAVE_LABEL[request.requestType] || request.requestType,
        person: { id: e.id, name: e.name || "Unknown", avatarPath: e.avatar_path || null, dept: e.sub_department || e.department || "" },
        submittedAt: clockAt,
        clockAt,
        isStale: isStaleSince(clockAt, now),
        done: false,
        isHighPriority: false,
        attachmentCount: 0,
        chain: leaveChain(request),
        source: request,
    };
}

/**
 * A Transmittal slip awaiting Check by as an ApprovalItem (#254). The slip is
 * the source; the row opens its page, where the Check by plates are signed.
 */
export function transmittalToItem(slip, now = Date.now()) {
    const clockAt = slip.submittedAt ?? slip.createdAt;
    return {
        id: slip.id,
        queue: "transmittals",
        // The TG03 number leads, as staff quote it; the Company sits under it.
        ref: slip.entity || "TG03",
        title: slip.number,
        typeLabel: "Check by",
        // `list()` shapes the preparer as a plain name.
        person: {
            id: slip.preparedById,
            name: slip.preparedBy || "Unknown",
            avatarPath: null,
            dept: TRANSMITTAL_ORIGIN_LABELS[slip.origin] ?? "",
        },
        submittedAt: clockAt,
        clockAt,
        isStale: isStaleSince(clockAt, now),
        done: false,
        isHighPriority: slip.priority === TRANSMITTAL_PRIORITY.HIGH,
        attachmentCount: 0,
        chain: [],
        source: slip,
    };
}

/** "Mon, Sep 28, 2026 · 13:00–17:00 · 4 hrs" — the when of a leave or overtime request. */
export function leaveWhen(request) {
    if (!request) return "";
    const parts = [];
    if (request.date) {
        const d = new Date(`${request.date}T00:00:00`);
        parts.push(Number.isNaN(d.getTime()) ? request.date : d.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric", year: "numeric" }));
    }
    if (request.start_time && request.end_time) parts.push(`${request.start_time.slice(0, 5)}–${request.end_time.slice(0, 5)}`);
    if (request.hours) parts.push(`${request.hours} hrs`);
    return parts.join(" · ");
}

/** Compact age for a table cell: 45m, 5h, 3d. */
export function shortAge(iso, now = Date.now()) {
    if (!iso) return "—";
    const h = (Number(now) - new Date(iso).getTime()) / 3600000;
    if (Number.isNaN(h)) return "—";
    if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
    if (h < 24) return `${Math.round(h)}h`;
    return `${Math.round(h / 24)}d`;
}

/** "12 hours ago", "yesterday", "3 days ago". */
export function relativeAge(iso, now = Date.now()) {
    if (!iso) return "";
    const h = (Number(now) - new Date(iso).getTime()) / 3600000;
    if (Number.isNaN(h)) return "";
    if (h < 1) return "just now";
    if (h < 24) {
        const n = Math.round(h);
        return `${n} hour${n === 1 ? "" : "s"} ago`;
    }
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "Sep 28" this year, "Sep 28, 2025" otherwise — a table-cell date. */
export function shortDate(iso, now = Date.now()) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const sameYear = d.getFullYear() === new Date(now).getFullYear();
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
