import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import {
  CHANGELOG_UNREAD_EVENT,
  getUnreadVersion,
  setUnreadVersion,
} from "@/utils/changelogAccess";

// True while a release that What's New skipped for this person has not been
// looked at on the Release Notes page. Opening the page clears it.
export function useReleaseNotesDot(user) {
  const { pathname } = useLocation();
  const [, bump] = useState(0);
  const userId = user?.id;

  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    window.addEventListener(CHANGELOG_UNREAD_EVENT, onChange);
    onChange(); // the marker may have been set before we subscribed
    return () => window.removeEventListener(CHANGELOG_UNREAD_EVENT, onChange);
  }, []);

  const onPage = pathname === "/release-notes" || pathname.startsWith("/release-notes/");
  useEffect(() => {
    if (userId && onPage && getUnreadVersion(userId)) setUnreadVersion(userId, null);
  }, [userId, onPage]);

  return !!userId && !onPage && !!getUnreadVersion(userId);
}
