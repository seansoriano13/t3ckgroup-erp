/**
 * Queue logic for the approval pages.
 *
 * Both approval queues — the manager queue at `/approvals` and HR verification
 * at `/approvals/hr-verification` — shape the same dataset the same way: split
 * pending work by age, count it per employee, narrow it by the filter bar, and
 * order it. Keeping that here rather than in each page means the two queues
 * cannot drift apart, and it means the rules are testable without rendering a
 * page.
 *
 * Everything in this file is pure. `now` is always an injectable argument so a
 * test can pin the clock instead of waiting 48 hours.
 */

import { TASK_STATUS } from "../constants/status.js";
import { countChecklist, parseChecklist } from "./checklist.js";

/**
 * How old a pending task has to be before the queue calls it backlog.
 *
 * Two working days. A task logged Friday afternoon is still "active" on Monday
 * morning, which is the point — the badge should mean "nobody looked at this",
 * not "a weekend happened".
 */
export const STALE_AFTER_HOURS = 48;

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Age of a task in hours, or `null` when it has no creation timestamp.
 *
 * Null rather than 0 so callers have to decide what a missing date means for
 * them — the two queues answer that question differently (see `isStaleTask`
 * and `isActiveTask`).
 */
export function taskAgeInHours(task, now = Date.now()) {
    const createdAt = task?.createdAt;
    if (!createdAt) return null;
    const created = new Date(createdAt).getTime();
    if (Number.isNaN(created)) return null;
    return (Number(now) - created) / MS_PER_HOUR;
}

/**
 * A task with no usable creation date is never called stale: flagging a row for
 * being old when we cannot say how old it is would send a manager chasing
 * nothing.
 */
export function isStaleTask(task, now = Date.now()) {
    const hours = taskAgeInHours(task, now);
    return hours !== null && hours >= STALE_AFTER_HOURS;
}

/** The complement of `isStaleTask` — undateable tasks stay visible as active. */
export function isActiveTask(task, now = Date.now()) {
    return !isStaleTask(task, now);
}

/** Splits a pending queue into `{ active, stale }` in a single pass. */
export function partitionByStaleness(tasks = [], now = Date.now()) {
    const active = [];
    const stale = [];
    for (const task of tasks) {
        if (isStaleTask(task, now)) stale.push(task);
        else active.push(task);
    }
    return { active, stale };
}

/**
 * Who is in this queue and how much of it is theirs, busiest first.
 *
 * Drives the quick-filter chips above the queue. Tasks with no author are
 * skipped rather than bucketed under "Unknown" — a chip that cannot be
 * filtered back out is worse than no chip.
 */
export function summariseQueueEmployees(tasks = []) {
    const byId = new Map();
    for (const task of tasks) {
        if (!task?.loggedById) continue;
        const entry = byId.get(task.loggedById) || {
            id: task.loggedById,
            name: task.loggedByName || "Unknown",
            avatar: task.loggedByAvatar,
            count: 0,
        };
        entry.count += 1;
        byId.set(task.loggedById, entry);
    }
    return [...byId.values()].sort(
        (a, b) => b.count - a.count || a.name.localeCompare(b.name),
    );
}

/**
 * Free-text search across the fields a reviewer can actually see on a queue
 * row, plus the payment voucher — finance search for tasks by voucher number.
 */
export function matchesSearchQuery(task, query) {
    const q = (query || "").trim().toLowerCase();
    if (!q) return true;
    return [
        task?.loggedByName,
        task?.categoryId,
        task?.taskDescription,
        task?.paymentVoucher,
    ].some((field) => (field || "").toLowerCase().includes(q));
}

/**
 * `YYYY-MM-DD` in the *local* zone.
 *
 * Deliberately not `toISOString()`. The app runs on Asia/Manila time and the
 * date the user picks is a Manila date; formatting through UTC would file a
 * task logged at 07:00 Manila under the previous day.
 */
export function toLocalDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/** The Monday..Sunday week containing `dateKey`, as local Date bounds. */
export function weekBoundsFor(dateKey) {
    const [y, m, d] = String(dateKey).split("-").map(Number);
    if (!y || !m || !d) return null;
    const picked = new Date(y, m - 1, d);
    const weekday = picked.getDay();
    // getDay() is 0 for Sunday, so Sunday belongs to the week that started six
    // days earlier rather than starting a new one.
    const mondayDate = picked.getDate() - weekday + (weekday === 0 ? -6 : 1);
    const start = new Date(picked);
    start.setDate(mondayDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

/**
 * Does a task fall inside the date the filter bar is showing?
 *
 * `selectedDateFilter` is whatever granularity `timeframe` implies: a full
 * `YYYY-MM-DD` for daily and weekly, `YYYY-MM` for monthly, `YYYY` for yearly.
 * An empty selection means "no date filter" and matches everything.
 */
export function matchesDateFilter(task, timeframe, selectedDateFilter) {
    if (!selectedDateFilter) return true;

    const taskDate = new Date(task?.createdAt);
    if (Number.isNaN(taskDate.getTime())) return false;
    const taskKey = toLocalDateKey(taskDate);

    if (timeframe === "DAILY") return taskKey === selectedDateFilter;
    if (timeframe === "MONTHLY" || timeframe === "YEARLY") {
        return taskKey.startsWith(selectedDateFilter);
    }
    if (timeframe === "WEEKLY") {
        const bounds = weekBoundsFor(selectedDateFilter);
        if (!bounds) return true;
        return taskDate >= bounds.start && taskDate <= bounds.end;
    }
    return true;
}

/**
 * The filter bar's status dropdown. "DELAYED" is not a stored status — it means
 * "still pending and past the staleness threshold", so it is answered here
 * rather than by a column comparison.
 */
export function matchesStatusFilter(task, statusFilter, now = Date.now()) {
    if (!statusFilter || statusFilter === "ALL") return true;
    if (statusFilter === "DELAYED") {
        const isPending =
            task?.status === TASK_STATUS.INCOMPLETE ||
            task?.status === TASK_STATUS.AWAITING_APPROVAL;
        return isPending && isStaleTask(task, now);
    }
    if (statusFilter === "NOT APPROVED") {
        return task?.status === TASK_STATUS.NOT_APPROVED;
    }
    return task?.status === statusFilter;
}

/**
 * Department and sub-department live on the employee, not the task, so this
 * needs the employee directory to answer. An unknown author matches nothing
 * once either filter is set — the alternative would leak tasks past a
 * department filter whenever the directory is still loading.
 */
export function matchesOrgFilter(task, { deptFilter, subDeptFilter }, employeesById) {
    const wantsDept = deptFilter && deptFilter !== "ALL";
    const wantsSubDept = subDeptFilter && subDeptFilter !== "ALL";
    if (!wantsDept && !wantsSubDept) return true;

    const owner = employeesById?.get(task?.loggedById);
    if (wantsDept && owner?.department !== deptFilter) return false;
    if (wantsSubDept && owner?.subDepartment !== subDeptFilter) return false;
    return true;
}

const SORTERS = {
    NEWEST: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
    OLDEST: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    NAME: (a, b) => (a.loggedByName || "").localeCompare(b.loggedByName || ""),
};

/** Orders a queue. An unrecognised `sortBy` leaves the incoming order alone. */
export function sortTasks(tasks = [], sortBy) {
    const sorter = SORTERS[sortBy];
    return sorter ? [...tasks].sort(sorter) : [...tasks];
}

/**
 * The whole filter bar applied in one call, then sorted.
 *
 * Both approval pages funnel through this so a filter can never be wired into
 * the UI on one page and silently ignored on the other.
 */
export function filterAndSortTasks(tasks = [], criteria = {}, now = Date.now()) {
    const {
        searchQuery = "",
        priorityFilter = "ALL",
        statusFilter = "ALL",
        timeframe,
        selectedDateFilter,
        deptFilter = "ALL",
        subDeptFilter = "ALL",
        employeeFilter = "ALL",
        sortBy,
        employees = [],
    } = criteria;

    const employeesById = new Map(employees.map((emp) => [emp.id, emp]));

    const filtered = tasks.filter((task) => {
        if (!matchesSearchQuery(task, searchQuery)) return false;
        if (priorityFilter !== "ALL" && task?.priority !== priorityFilter) {
            return false;
        }
        if (!matchesStatusFilter(task, statusFilter, now)) return false;
        if (employeeFilter !== "ALL" && task?.loggedById !== employeeFilter) {
            return false;
        }
        if (!matchesDateFilter(task, timeframe, selectedDateFilter)) return false;
        if (!matchesOrgFilter(task, { deptFilter, subDeptFilter }, employeesById)) {
            return false;
        }
        return true;
    });

    return sortTasks(filtered, sortBy);
}

/**
 * True when a task description holds a serialised checklist rather than prose.
 *
 * Requires the string to actually parse. A description that merely opens with a
 * bracket — "[URGENT] fix the printer" — is prose, and rendering it through the
 * checklist renderer would show the reviewer an empty list instead of the text.
 */
export function isChecklistDescription(description) {
    if (typeof description !== "string") return false;
    const trimmed = description.trim();
    if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;
    try {
        JSON.parse(trimmed);
        return true;
    } catch {
        return false;
    }
}

/**
 * "2/5" for the checklist badge, or `null` when there is nothing to count.
 *
 * Progress is read off `item.checked`, which is the field the checklist
 * renderer writes; any other spelling would report every checklist as
 * untouched.
 */
export function checklistProgressLabel(description) {
    if (!isChecklistDescription(description)) return null;
    const items = parseChecklist(description);
    if (items.length === 0) return null;
    const { total, checked } = countChecklist(description);
    return `${checked}/${total}`;
}

/**
 * Which triage action a keypress means, or `null` for "not a shortcut".
 *
 * Pulled out of the pane so the rules can be tested directly, and so there is
 * one place that answers the question that matters most here: a keystroke must
 * never grade or submit a task the reviewer is only reading.
 */
export function resolveApprovalShortcut(event, { isHr = false, isReadOnly = false } = {}) {
    if (!event) return null;

    const target = event.target;
    const isTextEntry =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;

    // Ctrl/Cmd+Enter submits from inside the remarks box; nothing else fires
    // while the reviewer is typing, or they would grade a task mid-sentence.
    if (isTextEntry) {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            return isReadOnly ? null : "submit";
        }
        return null;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return null;

    // The queue list is a keyboard-navigable listbox: Enter there means "open
    // this row", and must not also fire the pane's approve action.
    if (target?.closest?.("[data-approval-queue]")) return null;

    if (isReadOnly) return null;

    const key = event.key;

    if (!isHr && key >= "1" && key <= "5") return `grade:${key}`;
    if (key === "Enter") return "submit";
    if (isHr && key.toLowerCase() === "v") return "submit";
    if (key.toLowerCase() === "x") return "reject";

    return null;
}

/**
 * How many rows the queue should render.
 *
 * `requestedCount` is how far the reviewer has scrolled the list open; the
 * window is clamped to the dataset and stretched to include the active row, so
 * a deep link straight to the 400th task still shows the row it selected.
 * Deriving this rather than storing it is what keeps the list from needing an
 * effect to chase the dataset every time a task leaves the queue.
 */
export function deriveVisibleCount({ requestedCount, activeIndex = -1, total = 0 }) {
    return Math.min(total, Math.max(requestedCount, activeIndex + 1));
}

/**
 * Which task J / K should move to, or `null` at either end of the queue.
 *
 * Returns an id rather than an index because the caller holds the selection as
 * an id — the list can be re-sorted or re-filtered between keypresses.
 */
export function neighbourTaskId(tasks = [], activeIndex, direction) {
    if (activeIndex < 0) return null;
    const target = direction === "next" ? activeIndex + 1 : activeIndex - 1;
    if (target < 0 || target >= tasks.length) return null;
    return tasks[target].id;
}

/** Which way a navigation keypress moves, or `null` for "not a navigation key". */
export function resolveNavigationKey(event) {
    if (!event) return null;
    const target = event.target;
    if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true
    ) {
        return null;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return null;

    if (event.key === "j" || event.key === "ArrowDown") return "next";
    if (event.key === "k" || event.key === "ArrowUp") return "prev";
    return null;
}

/**
 * Which task should be selected after the queue changes under the reviewer.
 *
 * Approving a task drops it out of the list. Rather than leaving the pane
 * pointing at a row that no longer exists, selection falls to the head of the
 * queue — and to nothing at all once the queue empties.
 */
export function reconcileActiveTaskId(tasks = [], activeTaskId) {
    if (tasks.length === 0) return null;
    if (activeTaskId && tasks.some((t) => t.id === activeTaskId)) return activeTaskId;
    return tasks[0].id;
}

/** Adds or removes an id from a bulk selection, without mutating the original. */
export function toggleSelectedId(selectedIds = [], id) {
    return selectedIds.includes(id)
        ? selectedIds.filter((selected) => selected !== id)
        : [...selectedIds, id];
}
