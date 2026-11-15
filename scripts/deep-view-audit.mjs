// Deep view audit: the screens people rarely see. Optional pages, windows that only open from
// another window, links to records that are gone, and old addresses. For each one it records what
// the screen says, whether it broke, and whether the address can bring the same view back.
//
//   pnpm dev                                    # the app, on the local Supabase stack
//   node scripts/deep-view-audit.mjs            # every deep view, laptop and phone
//   node scripts/deep-view-audit.mjs --base http://localhost:5186 --views "^bad-" --sizes laptop
//   node scripts/deep-view-audit.mjs --resume   # carry on after a stopped run
//
// Output: scratch/deep-view-audit/<size>/<view>.png and scratch/deep-view-audit/results.json.
// Local only: it signs in with a local mock login (docs/mock-employees.md). It reads the local
// database for sample record ids and writes nothing.
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
  console.error(`deep-view-audit runs against the local app only, not ${BASE}`);
  process.exit(1);
}
const OUT = path.resolve(repoRoot, arg("out") ?? "scratch/deep-view-audit");
const EMAIL = process.env.AUDIT_EMAIL ?? "101@local";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "local";
const onlyViews = arg("views") ? new RegExp(arg("views")) : null;
const onlySizes = arg("sizes") ? new RegExp(arg("sizes")) : null;
const LATEST_RELEASE = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/changelog.json"), "utf8"))[0]?.version ?? "";
const GONE = "00000000-0000-4000-8000-00000000dead"; // a record id that does not exist

const SIZES = {
  laptop: { width: 1366, height: 650 },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
};

async function sampleIds() {
  const client = new pg.Client({ connectionString: process.env.LOCAL_DB_URL ?? env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL });
  await client.connect();
  const one = async (sql, params) => {
    try {
      return (await client.query(sql, params)).rows[0]?.id ?? null;
    } catch {
      return null;
    }
  };
  try {
    return {
      employee: await one("select id from employees where email = $1", [EMAIL]),
      sor: await one("select id from sales_opportunities where deleted_at is null order by updated_at desc limit 1"),
      costingSor: await one("select opportunity_id as id from costing_matrices order by updated_at desc limit 1"),
      task: await one("select id from tasks order by created_at desc limit 1"),
      groupTask: await one("select id from committee_tasks order by created_at desc limit 1"),
      pr: await one("select id from purchase_requests order by created_at desc limit 1"),
      ipas: await one("select id from ipas order by created_at desc limit 1"),
      transmittal: await one("select id from transmittals order by created_at desc limit 1"),
      packing: await one("select id from packing_lists order by created_at desc limit 1"),
      snapshot: await one("select id from flow_snapshots order by created_at desc limit 1"),
      bug: await one("select id from bug_reports order by created_at desc limit 1"),
      meeting: await one("select id from meeting_requests order by created_at desc limit 1"),
    };
  } finally {
    await client.end();
  }
}

const openNav = async (page, size) => {
  if (size.width < 768) {
    await page.getByRole("button", { name: /open navigation|menu/i }).first().click();
    await page.waitForTimeout(700);
  }
};
const click = (name, role = "button") => async (page) => {
  await page.getByRole(role, { name }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
};
const clickText = (text) => async (page) => {
  await page.getByText(text, { exact: true }).first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
};
const clickFirst = (selector) => async (page) => {
  await page.locator(selector).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
};
const steps = (...fns) => async (page, size) => {
  for (const fn of fns) await fn(page, size);
};
const sorTab = (label) => steps(clickFirst(`[role=dialog] button:has-text("${label}")`));

// `expectLink: true` marks a view that shows one record or one tab: the address should name it,
// so the audit reloads the address afterwards and checks the same view comes back.
const views = (id) => [
  // The circled Close button: the phone menu and its profile menu.
  { id: "nav-drawer", path: "/", action: openNav, phoneOnly: true },
  { id: "nav-drawer-profile-menu", path: "/", action: steps(openNav, clickFirst('[role=dialog] [class*="justify-between"]:has(svg)')), phoneOnly: true },

  // Tabs inside the SOR window. PMS carries the Beta tag.
  { id: "sor-window", path: `/sors?open=sor:${id.sor}`, expectLink: true },
  { id: "sor-tab-products", path: `/sors?open=sor:${id.sor}`, action: sorTab("Products"), expectLink: true },
  { id: "sor-tab-pms-beta", path: `/sors?open=sor:${id.costingSor ?? id.sor}`, action: sorTab("PMS"), expectLink: true },
  { id: "sor-tab-history", path: `/sors?open=sor:${id.sor}`, action: sorTab("History"), expectLink: true },
  { id: "sor-tab-commission", path: `/sors?open=sor:${id.sor}`, action: sorTab("Commission"), expectLink: true },
  { id: "sor-window-view-param", path: `/sors?record=${id.costingSor ?? id.sor}&view=pms`, expectLink: true },
  { id: "sor-quick-view", path: `/tasks?open=sor-quick:${id.sor}`, expectLink: true },

  // Record windows opened from the global quick links.
  { id: "task-window", path: `/tasks?open=task:${id.task}`, expectLink: true },
  { id: "group-task-window", path: `/group-tasks?open=group-task:${id.groupTask}`, expectLink: true },
  { id: "purchase-request-window", path: `/purchasing?request=${id.pr}`, expectLink: true },
  { id: "purchase-request-chat-tab", path: `/purchasing?request=${id.pr}`, action: clickFirst('[role=dialog] button:has-text("Chat"), [role=dialog] [role=tab]:has-text("Chat")'), expectLink: true },
  { id: "bug-report-window", path: `/bug-reports?record=${id.bug}`, expectLink: true },
  { id: "chats", path: "/", action: steps(openNav, clickFirst('button[aria-label*="hat" i]:visible, button[title*="hat" i]:visible')) },
  { id: "broadcast", path: "/", action: steps(openNav, clickFirst('button[aria-label*="roadcast" i]:visible, button[title*="roadcast" i]:visible')) },

  // Rare pages.
  { id: "s0-evaluation-record", path: `/costing-matrix/${id.costingSor}`, expectLink: true },
  { id: "technical-record", path: `/technical/${id.costingSor}`, expectLink: true },
  { id: "ipas-settings", path: "/purchasing/ipas/settings" },
  { id: "ipas-print-preview", path: `/purchasing/ipas/${id.ipas}`, action: click(/print/i), expectLink: true },
  { id: "transmittal-record", path: `/purchasing/transmittals/${id.transmittal}` },
  { id: "packing-list-record", path: `/purchasing/packing-lists/${id.packing}` },
  { id: "purchasing-dashboard-panel", path: "/purchasing/dashboard", action: clickFirst("main table tbody tr"), expectLink: true },
  { id: "commission-deal-window", path: "/sors/commission", action: clickFirst("main table tbody tr"), expectLink: true },
  { id: "approvals-leaves-sheet", path: "/approvals/leaves", action: clickFirst("main table tbody tr"), expectLink: true },
  { id: "approvals-tasks-sheet", path: "/approvals/tasks", action: clickFirst("main table tbody tr"), expectLink: true },
  { id: "approvals-transmittals-row", path: "/approvals/transmittals", action: clickFirst("main table tbody tr, main [role=button]"), expectLink: true },
  { id: "approvals-bid-decisions-row", path: "/approvals/bid-decisions", action: clickFirst("main table tbody tr, main [role=button]"), expectLink: true },
  { id: "approvals-hr-verification-row", path: "/approvals/hr-verification", action: clickFirst("main table tbody tr, main [role=button]"), expectLink: true },
  { id: "my-task-row", path: "/tasks", action: clickFirst("main table tbody tr, main [data-testid*=task]"), expectLink: true },
  { id: "group-task-row", path: "/group-tasks", action: clickFirst("main table tbody tr, main [role=button]"), expectLink: true },
  { id: "activity-log-row", path: "/super-admin/activity-log", action: clickFirst("main [role=button], main li button, main table tbody tr"), expectLink: true },
  { id: "order-monitoring", path: "/purchasing/order-monitoring" },
  { id: "canvasses", path: "/purchasing/canvasses" },
  { id: "transmittal-new", path: "/purchasing/transmittals/new" },
  { id: "flow-snapshot", path: `/flow-versions/${id.snapshot}` },
  { id: "group-task-templates", path: "/group-tasks/templates" },
  { id: "group-task-template-editor", path: "/group-tasks/templates", action: clickFirst('main button:has-text("New"), main button:has-text("Template")'), expectLink: true },
  { id: "commission", path: "/sors/commission" },
  { id: "commission-formula", path: "/sors/commission-formula" },
  { id: "retail", path: "/retail" },
  { id: "release-notes", path: "/release-notes" },
  { id: "super-admin-home", path: "/super-admin" },
  { id: "activity-log", path: "/super-admin/activity-log" },
  { id: "lead-sources", path: "/super-admin/lead-sources" },
  { id: "super-admin-commission", path: "/super-admin/commission" },
  { id: "flow-canvas", path: "/super-admin/flow-canvas" },
  { id: "hr-home", path: "/hr" },
  { id: "hr-directory-edit", path: "/hr/management", action: clickFirst("main table tbody tr button, main table tbody tr"), expectLink: true },
  { id: "hr-time-off-sheet", path: "/hr/offsets", action: clickFirst('[role="button"][aria-label^="Open "]'), expectLink: true },
  { id: "my-requests", path: "/offsets" },
  { id: "calendar", path: "/calendar" },
  { id: "calendar-entry", path: "/calendar", action: clickFirst('main [role="button"][aria-label], main button[data-entry-id], main [data-testid*="entry"]'), expectLink: true },
  { id: "approvals-home", path: "/approvals" },
  { id: "approvals-transmittals", path: "/approvals/transmittals" },
  { id: "approvals-bid-decisions", path: "/approvals/bid-decisions" },
  { id: "approvals-hr-verification", path: "/approvals/hr-verification" },
  { id: "approvals-meetings-record", path: `/approvals/meetings?record=${id.meeting}`, expectLink: true },
  ...["general", "approvals", "hr", "venues", "sales", "purchasing", "costing", "groups", "announcements"].map((t) => ({ id: `settings-${t}`, path: `/settings?tab=${t}`, expectLink: true })),
  { id: "settings-faq", path: "/settings", action: clickFirst('main button:has-text("FAQ"), button:has-text("Help")'), expectLink: true },
  { id: "profile", path: "/profile" },

  // Links to a record that is gone, or that the reader cannot open.
  { id: "bad-task", path: `/tasks?open=task:${GONE}`, bad: true },
  { id: "bad-group-task", path: `/group-tasks?open=group-task:${GONE}`, bad: true },
  { id: "bad-sor", path: `/sors?open=sor:${GONE}`, bad: true },
  { id: "bad-sor-record", path: `/sors?record=${GONE}`, bad: true },
  { id: "bad-purchase-request", path: `/purchasing?request=${GONE}`, bad: true },
  { id: "bad-ipas", path: `/purchasing/ipas/${GONE}`, bad: true },
  { id: "bad-transmittal", path: `/purchasing/transmittals/${GONE}`, bad: true },
  { id: "bad-packing-list", path: `/purchasing/packing-lists/${GONE}`, bad: true },
  { id: "bad-s0-evaluation", path: `/costing-matrix/${GONE}`, bad: true },
  { id: "bad-technical", path: `/technical/${GONE}`, bad: true },
  { id: "bad-flow-snapshot", path: `/flow-versions/${GONE}`, bad: true },
  { id: "bad-bug-report", path: `/bug-reports?record=${GONE}`, bad: true },
  { id: "bad-approval-leave", path: `/approvals/leaves?record=${GONE}`, bad: true },
  { id: "bad-approval-meeting", path: `/approvals/meetings?record=${GONE}`, bad: true },
  { id: "bad-approval-task", path: `/approvals/tasks?record=${GONE}`, bad: true },
  { id: "bad-not-a-uuid", path: "/purchasing/ipas/not-a-real-id", bad: true },
  { id: "bad-settings-tab", path: "/settings?tab=nope", bad: true },
  { id: "bad-open-key", path: "/?open=banana:1", bad: true },
  { id: "not-found", path: "/does-not-exist", bad: true },

  // Old addresses that should still land somewhere.
  { id: "old-opportunities", path: `/opportunities?record=${id.sor}` },
  { id: "old-crm", path: "/crm" },
  { id: "old-my-sors", path: "/my-sors" },

  // Signed-out pages.
  { id: "verify-bad-token", path: "/verify/not-a-real-token", anon: true, bad: true },
  { id: "reset-password-no-token", path: "/reset-password", anon: true },
  { id: "signed-out-deep-link", path: `/purchasing/ipas/${id.ipas}`, anon: true },
];

// Runs in the page.
function measure() {
  const vw = innerWidth;
  const vh = innerHeight;
  const shown = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05;
  };
  const text = (e) => (e?.innerText || "").trim().replace(/\s+/g, " ");
  const dialogs = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter(shown).map((d) => {
    const r = d.getBoundingClientRect();
    return { label: (d.getAttribute("aria-label") || text(d.querySelector("h1, h2, h3")) || text(d)).slice(0, 60), fits: r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1 };
  });
  const top = dialogs.length ? [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter(shown).pop() : document.querySelector("main") || document.body;
  // A control with another control sitting on top of part of it: the circled Close button problem.
  const name = (e) => (text(e) || e.getAttribute("aria-label") || e.getAttribute("title") || e.tagName).slice(0, 30);
  const isControl = (e) => e.matches("button, a[href], [role=button], [role=tab], [role=menuitem], input, select, textarea, .cursor-pointer");
  const controls = [...top.querySelectorAll("button, a[href], [role=button], [role=tab], [role=menuitem], .cursor-pointer")].filter(shown);
  const overlaps = new Set();
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    if (r.width < 12 || r.height < 12) continue;
    const points = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 4, r.top + 4], [r.right - 4, r.top + 4], [r.left + 4, r.bottom - 4], [r.right - 4, r.bottom - 4]];
    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      const hit = document.elementFromPoint(x, y);
      if (!hit || el.contains(hit) || hit.contains(el)) continue;
      let cover = hit;
      while (cover && cover !== document.body && !isControl(cover)) cover = cover.parentElement;
      if (!cover || cover === document.body || cover.contains(el) || el.contains(cover)) continue;
      overlaps.add(`"${name(cover)}" sits on top of "${name(el)}"`);
    }
  }
  return {
    url: location.pathname + location.search,
    title: document.title,
    dialogs,
    sideScroll: document.documentElement.scrollWidth - vw,
    overlaps: [...overlaps].slice(0, 6),
    toasts: [...document.querySelectorAll("[role=status]")].filter(shown).map(text).filter(Boolean).slice(0, 3),
    stillLoading: /Loading/i.test(text(top).slice(0, 3000)),
    says: text(top).slice(0, 260),
    blank: text(top).length < 12,
  };
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await page.waitForFunction(() => !/Loading/i.test(((document.querySelector("[role=dialog]") || document.querySelector("main") || document.body).innerText || "").slice(0, 3000)), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function login(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await page.locator("#login-email").waitFor({ timeout: 180000 });
  await page.locator("#login-email").fill(EMAIL);
  await page.locator("#login-password").fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
  await settle(page);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

// Local stack noise: realtime and the edge functions are not running locally.
const NOISE = /GSI_LOGGER|Outdated Optimize Dep|favicon|Download the React DevTools|\[vite\]|sentry|bugsink|realtime\/v1|functions\/v1|Auto-sync Odoo|status of 503/i;

async function main() {
  const ids = await sampleIds();
  const browser = await chromium.launch();
  const state = await login(browser);
  const file = path.join(OUT, "results.json");
  // A partial run (--views, --sizes) adds to the last results instead of replacing them.
  const results = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  for (const [sizeName, size] of Object.entries(SIZES)) {
    if (onlySizes && !onlySizes.test(sizeName)) continue;
    fs.mkdirSync(path.join(OUT, sizeName), { recursive: true });
    const options = { viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch };
    const ctx = await browser.newContext({ ...options, storageState: state });
    await ctx.addInitScript(([id, version]) => {
      try {
        if (id) localStorage.setItem(`changelog_dismissed_${id}`, version);
      } catch {
        /* storage blocked: the popup just shows */
      }
    }, [ids.employee, LATEST_RELEASE]);
    for (const view of views(ids)) {
      if (onlyViews && !onlyViews.test(view.id)) continue;
      if (view.phoneOnly && sizeName !== "phone") continue;
      const key = `${sizeName}/${view.id}`;
      // --resume skips views the last run already finished.
      if (process.argv.includes("--resume") && results[key] && !results[key].error) continue;
      const page = view.anon ? await (await browser.newContext(options)).newPage() : await ctx.newPage();
      const errors = [];
      const failed = [];
      page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 160)));
      page.on("console", (m) => {
        if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text().slice(0, 160));
      });
      page.on("response", (r) => {
        if (r.status() >= 400 && !NOISE.test(r.url())) failed.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 110)}`);
      });
      const row = { path: view.path, kind: view.bad ? "bad link" : view.anon ? "signed out" : view.expectLink ? "record or tab" : "page" };
      try {
        await page.goto(BASE + view.path, { waitUntil: "domcontentloaded", timeout: 60000 });
        await settle(page);
        const addressBefore = await page.evaluate(() => location.pathname + location.search);
        if (view.action) {
          try {
            await view.action(page, size);
            await settle(page);
          } catch (err) {
            row.actionFailed = String(err.message).split("\n")[0].slice(0, 140);
          }
        }
        Object.assign(row, await page.evaluate(measure));
        await page.screenshot({ path: path.join(OUT, sizeName, `${view.id}.png`) });
        // A view that was opened by a click (a tab, a row) can only come back from the address
        // if the click changed the address.
        if (view.expectLink && view.action && !row.actionFailed) row.linkKeepsView = row.url !== addressBefore;
      } catch (err) {
        row.error = String(err.message).split("\n")[0].slice(0, 200);
      }
      row.errors = [...new Set(errors)].slice(0, 5);
      row.failed = [...new Set(failed)].slice(0, 5);
      results[key] = row;
      const flags = [
        row.error && "AUDIT FAILED",
        row.actionFailed && "could not open",
        row.blank && "BLANK",
        row.stillLoading && "still loading",
        row.linkKeepsView === false && "NO LINK",
        row.overlaps?.length && "OVERLAP",
        row.sideScroll > 0 && "side scroll",
        row.dialogs?.some((d) => !d.fits) && "window does not fit",
        row.errors.length && `${row.errors.length} errors`,
        row.failed.length && `${row.failed.length} failed requests`,
      ].filter(Boolean);
      console.log(`${key.padEnd(40)} ${flags.join(", ") || "ok"}`);
      await page.close();
      fs.writeFileSync(file, JSON.stringify(results, null, 1));
    }
    await ctx.close();
  }
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
