// Notification click audit: plants one notification of every type for a local mock login,
// clicks it in the bell, and records where the click lands (a new address, a window, or nothing).
//
//   pnpm dev                                         # the app, on the local Supabase stack
//   node scripts/notification-click-audit.mjs        # every type
//   node scripts/notification-click-audit.mjs --base http://localhost:5186 --only "^MEETING"
//
// Output: scratch/notification-click-audit.json and a table on the terminal.
// Local only: it writes test rows (title starts with "[AUDIT]") to the LOCAL notifications table
// and removes them when it ends. Never point it at staging or production.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { DEFAULT_LOCAL_DB_URL, loadDotEnvLocal } from "./lib/seedShared.mjs";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = loadDotEnvLocal(repoRoot);
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const BASE = arg("base") ?? "http://localhost:5173";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error(`notification-click-audit runs against the local app only, not ${BASE}`);
  process.exit(1);
}
const DB_URL = process.env.LOCAL_DB_URL ?? env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL;
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DB_URL)) {
  console.error("notification-click-audit writes to the local database only.");
  process.exit(1);
}
const EMAIL = process.env.AUDIT_EMAIL ?? "101@local";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "local";
// A light page to start each click from, so the app is not busy loading the dashboard.
const START = arg("start") ?? "/release-notes";
const only = arg("only") ? new RegExp(arg("only")) : null;
const OUT = path.resolve(repoRoot, arg("out") ?? "scratch/notification-click-audit.json");
const LATEST_RELEASE = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/changelog.json"), "utf8"))[0]?.version ?? "";

// Each type, grouped by the record its reference_id names.
const TYPES = {
  task: ["NEW_TASK_SUBMITTED", "TASK_COMMENT", "TASK_AWAITING_APPROVAL", "TASK_COMPLETED", "TASK_GRADED", "TASK_VERIFIED", "TASK_ASSIGNED", "TASK_REJECTED", "TASK_APPROVED_BY_HEAD", "TASK_REACTION", "TASK_MENTION", "TASK_CONVERTED", "STAGE_ACTION_TASK_CREATED"],
  groupTask: ["GROUP_ASSIGNED", "GROUP_TASK_COMMENT", "GROUP_TASK_REACTION", "GROUP_TASK_MENTION", "GROUP_TASK_READY_FOR_HR", "GROUP_TASK_AWAITING_EVALUATION", "GROUP_TASK_EVALUATION_REMINDER", "GROUP_TASK_REOPENED", "GROUP_MEMBER_DONE"],
  sor: ["OPPORTUNITY_STAGE_REVERTED", "OPPORTUNITY_ACTION_DECISION_DUE", "OPPORTUNITY_COSTING_INCHARGE_NEEDED", "OPPORTUNITY_FOLLOW_UP_DUE", "OPPORTUNITY_MENTION", "SOR_AWARDED", "SOR_BID_DECISION", "SOR_STAGE_PARTICIPANT_ADDED", "COSTING_EVALUATION_ASSIGNED"],
  pr: ["PURCHASE_REQUEST_OPENED", "PURCHASE_REQUEST_MESSAGE", "PURCHASE_REQUEST_MENTION", "PURCHASE_REQUEST_ITEM_STATUS", "PURCHASE_REQUEST_BUYER_SET", "PURCHASE_REQUEST_ORDERED_EARLY"],
  ipas: ["IPAS_SIGNOFF_READY", "IPAS_SENT_BACK"],
  transmittal: ["TRANSMITTAL_SUBMITTED", "TRANSMITTAL_CANCELLED", "TRANSMITTAL_STAGE_READY", "TRANSMITTAL_CONFIRM_SIGNATURE", "TRANSMITTAL_NA_RAISED", "TRANSMITTAL_CLOSED", "TRANSMITTAL_SIGNATURE_DECLINED", "TRANSMITTAL_SIGNATURE_UNDONE"],
  packing: ["PACKING_LIST_REQUESTED"],
  meeting: ["MEETING_REQUEST", "MEETING_REQUEST_DECISION", "MEETING_APPROVED", "MEETING_CANCELLED", "MEETING_CHANGED", "MEETING_REMINDER"],
  sil: ["SIL_LEAVE_REQUEST", "SIL_LEAVE_DECISION", "SIL_LEAVE_HEAD_DECISION", "SIL_LEAVE_CANCELLED"],
  lwop: ["LWOP_LEAVE_REQUEST", "LWOP_LEAVE_DECISION", "LWOP_LEAVE_HEAD_DECISION", "LWOP_LEAVE_CANCELLED"],
  offset: ["OFFSET_LEAVE_REQUEST", "OFFSET_LEAVE_DECISION", "OFFSET_LEAVE_HEAD_DECISION"],
  overtime: ["OVERTIME_REQUEST", "OVERTIME_DECISION", "OVERTIME_HEAD_DECISION"],
  undertime: ["UNDERTIME_REQUEST", "UNDERTIME_DECISION", "UNDERTIME_HEAD_DECISION"],
  bug: ["BUG_REPORT_SUBMITTED", "BUG_REPORT_NOTE"],
  // Old rows still in people's bells from features that were replaced.
  legacy: ["UNPLANNED_ACTIVITY", "SALES_PLAN_SUBMITTED", "SALES_DAY_CONQUERED", "SALES_COMMENT", "DAY_DELETE_REQUESTED", "ACTIVITY_DELETE_REQUESTED", "EXPENSE_APPROVED", "PLAN_AMENDMENT_RESULT", "DAY_DELETE_RESULT", "SALES_QUOTA_PUBLISHED"],
  // A real type that arrives with no reference_id.
  none: ["TASK_COMPLETED"],
};

const SAMPLE_SQL = {
  task: "select id from tasks order by created_at desc limit 1",
  groupTask: "select id from committee_tasks order by created_at desc limit 1",
  sor: "select id from sales_opportunities where deleted_at is null order by updated_at desc limit 1",
  pr: "select id from purchase_requests order by created_at desc limit 1",
  ipas: "select id from ipas order by created_at desc limit 1",
  transmittal: "select id from transmittals order by created_at desc limit 1",
  packing: "select id from packing_lists order by created_at desc limit 1",
  meeting: "select id from meeting_requests order by created_at desc limit 1",
  sil: "select id from sil_leaves order by created_at desc limit 1",
  lwop: "select id from lwop_leaves order by created_at desc limit 1",
  offset: "select id from offset_leaves order by created_at desc limit 1",
  overtime: "select id from overtime_requests order by created_at desc limit 1",
  undertime: "select id from undertime_requests order by created_at desc limit 1",
  bug: "select id from bug_reports order by created_at desc limit 1",
};

const db = new pg.Client({ connectionString: DB_URL });
await db.connect();
const one = async (sql, params) => {
  try {
    return (await db.query(sql, params)).rows[0]?.id ?? null;
  } catch {
    return null;
  }
};
const cleanup = () => db.query("delete from notifications where title like '[AUDIT]%'");

const me = await one("select id from employees where email = $1", [EMAIL]);
if (!me) {
  console.error(`No local employee ${EMAIL}. Run pnpm seed:mock:local first.`);
  process.exit(1);
}
const samples = {};
for (const [kind, sql] of Object.entries(SAMPLE_SQL)) samples[kind] = await one(sql);
// AUDIT_TASK_ID names the task to link to, for a login that should open one of its own tasks.
if (process.env.AUDIT_TASK_ID) samples.task = process.env.AUDIT_TASK_ID;
samples.legacy = "00000000-0000-4000-8000-000000000001";
samples.none = null;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
await context.addInitScript(({ id, release }) => {
  // Keep the "what's new" window out of the way.
  try {
    localStorage.setItem(`changelog_dismissed_${id}`, release);
  } catch {
    /* storage may be blocked */
  }
}, { id: me, release: LATEST_RELEASE });
const page = await context.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e.message).slice(0, 200)));

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.locator("#login-email").fill(EMAIL);
await page.locator("#login-password").fill(PASSWORD);
await page.locator("#login-password").press("Enter");
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });

const bell = () => page.locator('button[aria-label*="otification" i]:visible, button[title*="otification" i]:visible').first();
const where = () => {
  const u = new URL(page.url());
  return u.pathname + u.search;
};

const results = [];
await cleanup();
for (const [kind, types] of Object.entries(TYPES)) {
  for (const type of types) {
    if (only && !only.test(type)) continue;
    const title = `[AUDIT] ${type}${kind === "none" ? " (no record id)" : ""}`;
    const referenceId = samples[kind];
    const row = { type, kind, referenceId, hasSample: kind === "none" || kind === "legacy" || Boolean(referenceId) };
    await cleanup();
    await db.query(
      "insert into notifications (recipient_id, type, title, message, reference_id) values ($1, $2, $3, $4, $5)",
      [me, type, title, "Audit row. Safe to delete.", referenceId ?? (kind === "none" ? null : "00000000-0000-4000-8000-000000000002")],
    );
    try {
      await page.goto(`${BASE}${START}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await bell().click({ timeout: 30000 });
      const item = page.getByText(title, { exact: true }).first();
      await item.waitFor({ state: "visible", timeout: 15000 });
      const before = where();
      consoleErrors.length = 0;
      await item.click();
      // Give the click up to 5s to do anything, then up to 15s more for a window to finish opening.
      const read = () =>
        page.evaluate((needle) => {
          const shown = (e) => {
            const r = e.getBoundingClientRect();
            const s = getComputedStyle(e);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
          };
          const dialogs = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter(shown);
          const drawerOpen = dialogs.some((d) => (d.innerText || "").includes(needle));
          const windows = dialogs
            .filter((d) => !(d.innerText || "").includes(needle))
            .map((d) => (d.getAttribute("aria-label") || d.querySelector("h1, h2, h3")?.innerText || d.innerText || "").trim().replace(/\s+/g, " ").slice(0, 60));
          const toasts = [...document.querySelectorAll("[role=status]")].filter(shown).map((t) => t.innerText.trim().slice(0, 100)).filter(Boolean);
          return { drawerOpen, windows, toasts };
        }, title);
      let state = await read();
      let after = where();
      const started = Date.now();
      while (Date.now() - started < 20000) {
        await page.waitForTimeout(500);
        state = await read();
        after = where();
        const moved = after !== before;
        if (state.windows.length || (referenceId && after.includes(referenceId))) break;
        if (!moved && Date.now() - started > 5000) break;
      }
      await page.waitForTimeout(700);
      state = await read();
      after = where();
      Object.assign(row, { before, after, ...state, errors: [...consoleErrors] });
      const opensRecord = state.windows.length > 0 || (referenceId && after.includes(referenceId));
      row.verdict = opensRecord ? "opens the record" : after !== before ? "PAGE ONLY (no record)" : state.drawerOpen ? "NOTHING (bell stays open)" : "NOTHING (bell closes)";
    } catch (err) {
      row.verdict = "AUDIT FAILED";
      row.error = String(err.message).split("\n")[0].slice(0, 200);
    }
    results.push(row);
    console.log(`${row.verdict.padEnd(26)} ${type.padEnd(38)} ${row.after ?? ""} ${row.windows?.length ? `[window: ${row.windows.join(" | ")}]` : ""} ${row.toasts?.length ? `[toast: ${row.toasts.join(" | ")}]` : ""}`);
  }
}

await cleanup();
await db.end();
await browser.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ base: BASE, login: EMAIL, samples, results }, null, 2));
const dead = results.filter((r) => r.verdict.startsWith("NOTHING"));
const pageOnly = results.filter((r) => r.verdict.startsWith("PAGE ONLY"));
console.log(`\n${results.length} types clicked, ${dead.length} go nowhere, ${pageOnly.length} reach a page but not the record. Saved ${path.relative(repoRoot, OUT)}`);
