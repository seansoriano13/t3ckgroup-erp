// Screen-fit audit: opens every screen at six screen sizes on the LOCAL app,
// saves a screenshot of each and measures how well it fits.
//
//   pnpm dev                                   # the app, on the local Supabase stack
//   pnpm audit:screens                         # every screen, every size
//   pnpm audit:screens --screens "^ipas" --sizes "phone|laptopS"
//   pnpm audit:screens --compare scratch/screen-audit/baseline.json
//
// Output: scratch/screen-audit/<size>/<screen>.png and scratch/screen-audit/metrics.json.
// --compare prints, per screen and size, where the page body starts (pageBodyTop) before and
// after, and flags any dialog that does not fit the screen or any sideways page scroll.
//
// Local only: it signs in with a local mock login (docs/mock-employees.md) and reads sample
// record ids from the local database. Never point it at staging or production.
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
  console.error(`screen-audit runs against the local app only, not ${BASE}`);
  process.exit(1);
}
const OUT = path.resolve(repoRoot, arg("out") ?? "scratch/screen-audit");
const EMAIL = process.env.AUDIT_EMAIL ?? "101@local"; // Super Admin mock login: sees every screen
const PASSWORD = process.env.AUDIT_PASSWORD ?? "local";
const LATEST_RELEASE = JSON.parse(fs.readFileSync(path.join(repoRoot, "src/data/changelog.json"), "utf8"))[0]?.version ?? "";
const onlyScreens = arg("screens") ? new RegExp(arg("screens")) : null;
const onlySizes = arg("sizes") ? new RegExp(arg("sizes")) : null;

// The six sizes of the screen-fit spec. "laptop band" = laptopS, laptopM, laptopL.
export const SIZES = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
  tablet: { width: 820, height: 1180, isMobile: true, hasTouch: true },
  laptopS: { width: 1280, height: 600 }, // 1920×1080 at 150% (or 1600×900 at 125%), minus browser bars
  laptopM: { width: 1366, height: 650 }, // 1366×768 at 100%
  laptopL: { width: 1536, height: 730 }, // 1920×1080 at 125%
  desktop: { width: 1920, height: 950 },
};

async function sampleIds() {
  const client = new pg.Client({ connectionString: process.env.LOCAL_DB_URL ?? env.LOCAL_DB_URL ?? DEFAULT_LOCAL_DB_URL });
  await client.connect();
  const one = async (sql) => (await client.query(sql)).rows[0]?.id ?? null;
  try {
    return {
      ipas: await one("select id from ipas order by created_at desc limit 1"),
      packing: await one("select id from packing_lists order by created_at desc limit 1"),
      transmittal: await one("select id from transmittals order by created_at desc limit 1"),
      costingSor: await one("select opportunity_id as id from costing_matrices order by updated_at desc limit 1"),
      snapshot: await one("select id from flow_snapshots order by created_at desc limit 1"),
      sor: await one("select id from sales_opportunities where deleted_at is null order by updated_at desc limit 1"),
      task: await one("select id from tasks order by created_at desc limit 1"),
      pr: await one("select id from purchase_requests order by created_at desc limit 1"),
      employee: (await client.query("select id from employees where email = $1", [EMAIL])).rows[0]?.id ?? null,
    };
  } finally {
    await client.end();
  }
}

const openNav = async (page, size) => {
  if (size.width < 768) {
    await page.getByRole("button", { name: /open navigation|menu/i }).first().click();
    await page.waitForTimeout(600);
  }
};
const quick = (label) => async (page, size) => {
  await openNav(page, size);
  await page.locator('button[title="Create new..."]:visible, button[aria-label="Create new"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: label }).first().click();
  await page.waitForTimeout(1500);
};
const clickFirst = (selector) => async (page) => {
  await page.locator(selector).first().click({ timeout: 15000 });
  await page.waitForTimeout(1500);
};
const tab = (name) => async (page) => {
  const loc = page.getByRole("tab", { name, exact: true }).or(page.getByRole("button", { name, exact: true })).or(page.getByRole("radio", { name, exact: true }));
  await loc.first().click({ timeout: 8000 });
  await page.waitForTimeout(1500);
};

// Every screen in the tracker. `id` matches the tracker and the spec's tickets.
export const screens = (id) => [
  { id: "login", path: "/login", anon: true },
  { id: "nav-drawer", path: "/", action: openNav },
  { id: "dashboard", path: "/" },
  { id: "tasks", path: "/tasks" },
  { id: "task-window", path: `/tasks?open=task:${id.task}` },
  { id: "my-requests", path: "/offsets" },
  { id: "calendar", path: "/calendar" },
  { id: "release-notes", path: "/release-notes" },
  { id: "group-tasks", path: "/group-tasks" },
  { id: "group-task-templates", path: "/group-tasks/templates" },
  { id: "sors", path: "/sors" },
  { id: "sors-list", path: "/sors", action: tab("List") },
  { id: "sors-board", path: "/sors", action: tab("Board") },
  { id: "sors-overview", path: "/sors", action: tab("Overview") },
  { id: "sor-window", path: `/sors?open=sor:${id.sor}` },
  { id: "costing-list", path: "/costing-matrix" },
  { id: "costing-record", path: `/costing-matrix/${id.costingSor}` },
  { id: "technical-list", path: "/technical" },
  { id: "technical-record", path: `/technical/${id.costingSor}` },
  { id: "commission", path: "/sors/commission" },
  { id: "commission-formula", path: "/sors/commission-formula" },
  { id: "retail", path: "/retail" },
  { id: "purchase-requests", path: "/purchasing" },
  { id: "purchase-request-record", path: `/purchasing?request=${id.pr}` },
  { id: "purchasing-dashboard", path: "/purchasing/dashboard" },
  { id: "canvasses", path: "/purchasing/canvasses" },
  { id: "ipas-list", path: "/purchasing/ipas" },
  { id: "ipas-record", path: `/purchasing/ipas/${id.ipas}` },
  { id: "transmittals", path: "/purchasing/transmittals" },
  { id: "transmittal-new", path: "/purchasing/transmittals/new" },
  { id: "transmittal-record", path: `/purchasing/transmittals/${id.transmittal}` },
  { id: "packing-lists", path: "/purchasing/packing-lists" },
  { id: "packing-list-record", path: `/purchasing/packing-lists/${id.packing}` },
  { id: "approvals-tasks", path: "/approvals/tasks" },
  { id: "approvals-tasks-sheet", path: "/approvals/tasks", action: clickFirst("table tbody tr") },
  { id: "approvals-leaves", path: "/approvals/leaves" },
  { id: "approvals-leaves-sheet", path: "/approvals/leaves", action: clickFirst("table tbody tr") },
  { id: "approvals-meetings", path: "/approvals/meetings" },
  { id: "approvals-ipas", path: "/approvals/ipas" },
  { id: "approvals-transmittals", path: "/approvals/transmittals" },
  { id: "approvals-bid-decisions", path: "/approvals/bid-decisions" },
  { id: "approvals-hr-verification", path: "/approvals/hr-verification" },
  { id: "hr-directory", path: "/hr/management" },
  { id: "hr-time-off", path: "/hr/offsets" },
  { id: "hr-time-off-sheet", path: "/hr/offsets", action: clickFirst('[role="button"][aria-label^="Open "]') },
  { id: "activity-log", path: "/super-admin/activity-log" },
  { id: "lead-sources", path: "/super-admin/lead-sources" },
  { id: "super-admin-commission", path: "/super-admin/commission" },
  { id: "flow-canvas", path: "/super-admin/flow-canvas" },
  { id: "flow-snapshot", path: `/flow-versions/${id.snapshot}` },
  { id: "bug-reports", path: "/bug-reports" },
  { id: "profile", path: "/profile" },
  { id: "settings", path: "/settings" },
  { id: "not-found", path: "/does-not-exist" },
  { id: "qa-log-task", path: "/", action: quick("Log Task") },
  { id: "qa-time-off", path: "/", action: quick("File Time Off / Overtime") },
  { id: "qa-meeting", path: "/", action: quick("New Meeting Request") },
  { id: "qa-group-task", path: "/", action: quick("Create Group Task") },
  { id: "qa-purchase-request", path: "/", action: quick("New Purchase Request") },
  { id: "qa-register-sor", path: "/", action: quick("Register SOR") },
  {
    id: "notifications",
    path: "/",
    action: async (page, size) => {
      const bell = page.locator('button[aria-label*="otification" i]:visible, button[title*="otification" i]:visible');
      if (!(await bell.count())) await openNav(page, size);
      await bell.first().click();
      await page.waitForTimeout(1200);
    },
  },
];

// Runs in the page: how well does this screen fit?
function measure() {
  const vw = innerWidth, vh = innerHeight;
  const shown = (e) => {
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05;
  };
  const describe = (e) => {
    const cls = String(e.getAttribute("class") ?? "").split(/\s+/).slice(0, 5).join(" ");
    const text = (e.innerText || e.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `${e.tagName.toLowerCase()}.${cls} "${text}"`;
  };
  const all = [...document.body.querySelectorAll("*")];
  const inView = (e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw; };
  const sideScrollers = all.filter((e) => { const s = getComputedStyle(e); return /auto|scroll/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 4 && e.clientWidth > 0 && shown(e); }).map((e) => `${describe(e)} box=${e.clientWidth} content=${e.scrollWidth}`);
  const smallTargets = all.filter((e) => e.matches("button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button], [role=tab]") && shown(e) && inView(e)).filter((e) => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) < 24; });
  const rect = (sel) => { const e = document.querySelector(sel); if (!e || !shown(e)) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
  const dialogs = [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].filter(shown).map((d) => {
    const r = d.getBoundingClientRect();
    return { label: describe(d).slice(0, 80), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), fitsW: r.left >= -1 && r.right <= vw + 1, fitsH: r.top >= -1 && r.bottom <= vh + 1 };
  });
  const scope = document.querySelector("[role=dialog]") || document.querySelector("main") || document.body;
  return {
    vw, vh,
    docOverflowX: document.documentElement.scrollWidth - vw,
    sideScrollers: sideScrollers.slice(0, 8),
    smallTargets: smallTargets.length,
    smallExamples: smallTargets.slice(0, 6).map(describe),
    pageBodyTop: rect('[data-testid="page-body"]')?.top ?? null,
    main: rect("main"),
    dialogs,
    loading: /Loading/i.test((scope.innerText || "").slice(0, 4000)),
    url: location.pathname + location.search,
  };
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 3500 }).catch(() => {});
  await page.waitForFunction(() => !/Loading/i.test(((document.querySelector("[role=dialog]") || document.querySelector("main") || document.body).innerText || "").slice(0, 4000)), null, { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function dismissWhatsNew(page) {
  const btn = page.getByRole("button", { name: "Continue to App" });
  if (await btn.count()) {
    await btn.first().click().catch(() => {});
    await page.waitForTimeout(800);
  }
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
  await dismissWhatsNew(page);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

function compare(baselineFile, current) {
  const base = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
  const rows = [];
  for (const [key, now] of Object.entries(current)) {
    const was = base[key];
    if (!was || now.error) continue;
    const moved = was.pageBodyTop != null && now.pageBodyTop != null ? now.pageBodyTop - was.pageBodyTop : null;
    const badDialog = (now.dialogs ?? []).some((d) => !d.fitsH || !d.fitsW);
    rows.push(`${key.padEnd(38)} body ${String(was.pageBodyTop).padStart(4)} → ${String(now.pageBodyTop).padStart(4)}${moved != null ? ` (${moved > 0 ? "+" : ""}${moved})` : ""}${badDialog ? "  DIALOG DOES NOT FIT" : ""}${now.docOverflowX > 0 ? "  SIDEWAYS PAGE SCROLL" : ""}`);
  }
  console.log(rows.sort().join("\n"));
}

async function main() {
  const ids = await sampleIds();
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" }); // the installed Chrome renders backdrop blur reliably
  } catch {
    browser = await chromium.launch();
  }
  const state = await login(browser);
  const metricsFile = path.join(OUT, "metrics.json");
  const results = fs.existsSync(metricsFile) ? JSON.parse(fs.readFileSync(metricsFile, "utf8")) : {};
  for (const [sizeName, size] of Object.entries(SIZES)) {
    if (onlySizes && !onlySizes.test(sizeName)) continue;
    fs.mkdirSync(path.join(OUT, sizeName), { recursive: true });
    const options = { viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch };
    const ctx = await browser.newContext({ ...options, storageState: state });
    // The What's New popup would cover the first screen of every size; mark this release as seen.
    await ctx.addInitScript(([id, version]) => {
      try { if (id) localStorage.setItem(`changelog_dismissed_${id}`, version); } catch { /* storage blocked: the popup just shows */ }
    }, [ids.employee, LATEST_RELEASE]);
    for (const screen of screens(ids)) {
      if (onlyScreens && !onlyScreens.test(screen.id)) continue;
      const key = `${sizeName}/${screen.id}`;
      const page = screen.anon ? await (await browser.newContext(options)).newPage() : await ctx.newPage();
      try {
        await page.goto(BASE + screen.path, { waitUntil: "domcontentloaded", timeout: 60000 });
        await settle(page);
        await dismissWhatsNew(page);
        if (screen.action) {
          await screen.action(page, size);
          await settle(page);
        }
        results[key] = await page.evaluate(measure);
        await page.screenshot({ path: path.join(OUT, sizeName, `${screen.id}.png`) });
        const m = results[key];
        console.log(`ok   ${key.padEnd(38)} body=${m.pageBodyTop} sideScroll=${m.docOverflowX} dialogsFit=${m.dialogs.every((d) => d.fitsH && d.fitsW)}${m.loading ? " (still loading)" : ""}`);
      } catch (error) {
        results[key] = { error: String(error.message).split("\n")[0].slice(0, 200) };
        console.log(`FAIL ${key.padEnd(38)} ${results[key].error}`);
      }
      await page.close();
      fs.writeFileSync(metricsFile, JSON.stringify(results, null, 1));
    }
    await ctx.close();
  }
  await browser.close();
  if (arg("compare")) compare(arg("compare"), results);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
