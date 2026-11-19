#!/usr/bin/env node
// Picks a random app module for an E2E sweep, skipping modules swept recently.
// "Swept" = an *e2e* tracker doc added in git history (any branch), or a commit
// subject that mentions e2e plus one of the module's keywords, inside the window.
//
//   node .claude/skills/e2e-module-sweep/pick-module.mjs [--days 45] [--list] [--module <id>] [--seed <n>] [--no-fetch]
import { execFileSync } from 'node:child_process';

const MODULES = [
  { id: 'activity-scheduling', name: 'Activity scheduling (Calendar, Activities, Venues, Settings > Activities)', keywords: ['activity-scheduling', 'activities', 'calendar', 'venue'], paths: ['src/pages/calendar', 'src/pages/approvals/meetings', 'src/components/calendar', 'src/components/settings/ActivitySettings.jsx', 'src/components/settings/VenueManager.jsx', 'src/services/meetingRequestService.js'] },
  { id: 'hr-time-off', name: 'HR and Time Off (My Requests, Offsets, HR Management, leave approvals)', keywords: ['hr-time-off', 'time-off', 'leave', 'offset', 'overtime'], paths: ['src/pages/hr', 'src/pages/offsets', 'src/pages/approvals/leaves', 'src/pages/approvals/hr-verification'] },
  { id: 'sors', name: 'SORS (sales opportunities, stages, flow versions, Commission Dashboard)', keywords: ['sors', 'sor', 's0'], paths: ['src/pages/sors', 'src/pages/my-sors', 'src/pages/flow-versions', 'src/pages/crm'] },
  { id: 's0-evaluation', name: 'S0 Evaluation and Technical (price corridor)', keywords: ['s0-', 's0 evaluation', 'technical', 'corridor'], paths: ['src/pages/technical', 'src/pages/costing-matrix'] },
  { id: 'tasks', name: 'Tasks and Group Tasks (My Tasks, Group Tasks, templates, Task Approvals)', keywords: ['task'], paths: ['src/pages/tasks', 'src/pages/group-tasks', 'src/pages/approvals/tasks'] },
  { id: 'purchasing', name: 'Purchasing (Purchase Requests, Canvasses, PMS, Order Monitoring)', keywords: ['purchasing', 'purchase', 'canvass', 'pms', 'order-monitoring'], paths: ['src/pages/purchasing'] },
  { id: 'ipas-transmittals', name: 'IPAS, Transmittals and Packing Lists', keywords: ['ipas', 'transmittal', 'packing'], paths: ['src/pages/purchasing/ipas', 'src/pages/purchasing/transmittals', 'src/pages/purchasing/packing-lists', 'src/pages/approvals/ipas', 'src/pages/approvals/transmittals'] },
  { id: 'commission-opportunities', name: 'Commission, Opportunities and Bid Decisions', keywords: ['commission', 'opportunit', 'bid'], paths: ['src/pages/opportunities', 'src/pages/sors/commission', 'src/pages/approvals/bid-decisions'] },
  { id: 'retail', name: 'Retail', keywords: ['retail'], paths: ['src/pages/retail'] },
  { id: 'settings', name: 'Settings (General, Approval Rules, HR & Schedule, Sales, Purchasing tabs)', keywords: ['settings'], paths: ['src/pages/settings'] },
  { id: 'accounts', name: 'Accounts (Login, Reset password, My Profile, Verify)', keywords: ['login', 'profile', 'password', 'auth'], paths: ['src/pages/login', 'src/pages/reset-password', 'src/pages/profile', 'src/pages/verify'] },
  { id: 'release-and-bugs', name: 'Release Notes and Bug Reports', keywords: ['release-notes', 'bug-report', 'changelog'], paths: ['src/pages/release-notes', 'src/pages/bug-reports'] },
  { id: 'super-admin', name: 'Super Admin (Activity Log, audit, admin tools)', keywords: ['super-admin', 'audit', 'activity-log'], paths: ['src/pages/super-admin'] },
];

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const days = Number(opt('days', 45));
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

if (!flag('no-fetch')) {
  try { git('fetch', 'origin', '--quiet'); } catch { /* offline is fine */ }
}

// Sweep evidence: [{ when: Date, source: string }]
const evidence = [];
const trackerLog = git('log', '--all', '--diff-filter=A', '--name-only', '--format=@@%cI', '--', 'docs').split('@@').slice(1);
for (const block of trackerLog) {
  const [when, ...files] = block.split('\n').filter(Boolean);
  for (const f of files) {
    if (/e2e/i.test(f) && /tracker/i.test(f)) evidence.push({ when: new Date(when), source: f.replace(/^docs\//, ''), text: f.toLowerCase() });
  }
}
for (const line of git('log', '--all', '-i', '--grep=e2e', '--format=%cI\t%s').split('\n').filter(Boolean)) {
  const [when, subject] = line.split('\t');
  if (!/e2e|playwright|browser story/i.test(subject)) continue; // --grep also matches commit bodies
  evidence.push({ when: new Date(when), source: `commit: ${subject}`, text: subject.toLowerCase() });
}

const cutoff = Date.now() - days * 86_400_000;
const state = MODULES.map((m) => {
  const hits = evidence.filter((e) => m.keywords.some((k) => e.text.includes(k)));
  const latest = hits.sort((a, b) => b.when - a.when)[0] ?? null;
  return { ...m, lastSwept: latest ? latest.when.toISOString().slice(0, 10) : null, via: latest?.source ?? null, recent: Boolean(latest && latest.when.getTime() >= cutoff) };
});

if (flag('list')) {
  for (const s of state) console.log(`${s.recent ? 'SKIP' : 'free'}  ${s.id.padEnd(26)} last swept: ${s.lastSwept ?? 'never'}${s.via ? `  (${s.via})` : ''}`);
  process.exit(0);
}

let rnd = Math.random;
if (opt('seed')) { let x = Number(opt('seed')) || 1; rnd = () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296); }

let pick;
if (opt('module')) pick = state.find((s) => s.id === opt('module'));
if (!pick) {
  const free = state.filter((s) => !s.recent);
  // Never swept first, so new ground comes before a re-check of old ground.
  const never = free.filter((s) => !s.lastSwept);
  const pool = never.length ? never : free.length ? free : [...state].sort((a, b) => String(a.lastSwept).localeCompare(String(b.lastSwept))).slice(0, 1);
  pick = pool[Math.floor(rnd() * pool.length)];
}

console.log(JSON.stringify({
  picked: { id: pick.id, name: pick.name, paths: pick.paths, lastSwept: pick.lastSwept },
  windowDays: days,
  skippedRecently: state.filter((s) => s.recent).map((s) => ({ id: s.id, lastSwept: s.lastSwept, via: s.via })),
  neverSwept: state.filter((s) => !s.lastSwept).map((s) => s.id),
}, null, 2));
