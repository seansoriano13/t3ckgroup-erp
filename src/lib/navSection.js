import { NAV_MODULES } from "@/constants/navigation";

const APP = "T3CKGROUP ERP";

const LINKS = Object.values(NAV_MODULES)
  .flatMap((module) => module.links)
  .map((entry) => ({ label: entry.label, link: entry.link }))
  // Longest path first, so "/sors/commission" beats "/sors".
  .sort((a, b) => b.link.length - a.link.length);

/** The side-menu name of the section a path belongs to, for the phone top bar. */
export function navSectionLabel(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "Dashboard";
  const hit = LINKS.find(({ link }) => link !== "/" && (path === link || path.startsWith(`${link}/`)));
  return hit ? hit.label : APP;
}
