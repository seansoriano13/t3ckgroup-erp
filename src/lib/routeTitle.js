import { isStaging, isLocal } from "@/lib/appEnv";

const APP = "T3CKGROUP ERP";

// Longest prefix wins. Keep in step with src/pages.
const TITLES = [
  ["/approvals/bid-decisions", "Bid Decisions"],
  ["/approvals/hr-verification", "HR Verification"],
  ["/approvals/ipas", "IPAS Sign-offs"],
  ["/approvals/leaves", "Leave Approvals"],
  ["/approvals/tasks", "Task Approvals"],
  ["/approvals/transmittals", "Transmittal Check by"],
  ["/approvals", "Approvals"],
  ["/bug-reports", "Bug Reports"],
  ["/flow-versions", "Flow Snapshot"],
  ["/group-tasks/templates", "Group Task Templates"],
  ["/group-tasks", "Group Tasks"],
  ["/hr/management", "HR Management"],
  ["/hr/offsets", "HR Offsets"],
  ["/hr", "HR"],
  ["/login", "Sign in"],
  ["/my-sors", "My SORs"],
  ["/offsets", "Offsets"],
  ["/profile", "Profile"],
  ["/purchasing/ipas", "IPAS"],
  ["/purchasing", "Purchasing"],
  ["/release-notes", "Release Notes"],
  ["/reset-password", "Reset Password"],
  ["/retail", "Retail"],
  ["/settings", "Settings"],
  ["/sors/commission", "Commission"],
  ["/sors", "SORs"],
  ["/super-admin/activity-log", "Activity Log"],
  ["/super-admin/commission", "Commission"],
  ["/super-admin/flow-canvas", "Flow Canvas"],
  ["/tasks", "Tasks"],
  ["/verify", "Verify"],
];

export function routeTitle(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  let label = null;
  if (path === "/") label = "Dashboard";
  else {
    const hit = TITLES.find(([p]) => path === p || path.startsWith(`${p}/`));
    label = hit ? hit[1] : "Page not found";
  }
  const base = label ? `${label} · ${APP}` : APP;
  if (isStaging) return `[STAGING] ${base}`;
  if (isLocal) return `[LOCAL] ${base}`;
  return base;
}
