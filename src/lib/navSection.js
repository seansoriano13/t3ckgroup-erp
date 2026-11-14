import { NAV_MODULES } from "@/constants/navigation";

const APP = "T3CKGROUP ERP";

const LINKS = Object.values(NAV_MODULES)
  .flatMap((module) => module.links)
  .map((entry) => ({ label: entry.label, link: entry.link }))
  // Longest path first, so "/sors/commission" beats "/sors".
  .sort((a, b) => b.link.length - a.link.length);

/**
 * The key of the side-menu group that holds the current page, or null. The
 * menu keeps this group open so you can see where you are, whatever open or
 * closed choice was saved.
 */
export function activeGroupKey(groups, pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  let best = null;
  for (const group of groups) {
    for (const entry of group.links) {
      const link = entry.link;
      const hit =
        link === "/" || entry.exactMatch
          ? path === link
          : path === link || path.startsWith(`${link}/`);
      if (hit && (!best || link.length > best.len)) best = { key: group.key, len: link.length };
    }
  }
  return best ? best.key : null;
}

/** The side-menu name of the section a path belongs to, for the phone top bar. */
export function navSectionLabel(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return "Dashboard";
  const hit = LINKS.find(({ link }) => link !== "/" && (path === link || path.startsWith(`${link}/`)));
  return hit ? hit.label : APP;
}
