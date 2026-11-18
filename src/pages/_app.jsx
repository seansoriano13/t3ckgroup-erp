import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { routeTitle } from "../lib/routeTitle";
import SideNav from "../components/SideNav";
import { useAuth } from "../context/AuthContext";
import { isResetPasswordPath } from "../lib/recoveryLink";
import ChangelogModal from "../components/ChangelogModal";
import IssuedPasswordBanner from "../components/IssuedPasswordBanner";

import { useCalendarFullScreenOn } from "../lib/calendarFullScreen";
import PageLoading from "@/components/ui/PageLoading";

export default function AppLayout() {
  const { user, isAuthLoading } = useAuth();
  const location = useLocation();
  const calendarFullScreen = useCalendarFullScreenOn();

  useEffect(() => {
    document.title = routeTitle(location.pathname);
  }, [location.pathname]);

  // Editor screens fill the frame instead of sitting in the centred page
  // column: a canvas that pans and zooms wants every pixel of it, and its own
  // floating toolbar already says what a page header would.
  // `/flow-versions/:id` is the same shape: a read-only Flow Snapshot, panned
  // and zoomed, opened from the version badge on an SOR.
  //
  // `/sors` joins them (issue #206, renamed by ADR 0024): the register is
  // something you pan or scan across (a board, a large list), not a form. Its
  // Commission pages are ordinary pages and stay centred.
  //
  // The legacy `/crm` and `/opportunities` paths are not listed: they render a
  // redirect, never the register, so the frame they would briefly get does not
  // matter and naming them here would only be one more place to keep in step.
  const isFullBleed =
    calendarFullScreen ||
    location.pathname.startsWith("/super-admin/flow-canvas") ||
    location.pathname.startsWith("/flow-versions/") ||
    (location.pathname.startsWith("/sors") &&
      !location.pathname.startsWith("/sors/commission"));

  if (
    location.pathname === "/login" ||
    isResetPasswordPath(location.pathname) ||
    location.pathname.startsWith("/verify/")
  ) {
    return <Outlet />;
  }

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mauve-2">
        <PageLoading label="portal" className="py-0" />
      </div>
    );
  }

  // Landing on any route while logged out has to end at the login screen.
  // Individual pages wrap themselves in ProtectedRoute for role checks, but
  // several never did, and those rendered a nav-less shell that stranded the
  // visitor until they hand-edited the URL back down to the root.
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }

  return (
    <div className="flex h-dvh flex-col md:flex-row bg-mauve-2 font-sans overflow-hidden">
      {!calendarFullScreen && <SideNav />}
      <ChangelogModal />

      <main className="flex-1 flex flex-col min-w-0 bg-background md:my-2 md:mr-2 md:ml-2 md:rounded-2xl border-l md:border border-border shadow-sm overflow-hidden relative z-10 transition-transform">
        {/* One tree for both shapes, so the page keeps its place when the frame flips (Calendar
            full screen does that while the page is open). Two different trees remounted the page,
            and the Calendar's own hook ends full screen when it unmounts: the button did nothing.
            `contents` gives the full-bleed shape no box of its own, so the page sits directly in
            the frame as before. */}
        <div className={isFullBleed ? "flex-1 min-h-0 overflow-hidden" : "flex-1 overflow-y-auto custom-scrollbar"}>
          <div className={isFullBleed ? "contents" : "wrapper pt-4 px-4 md:pt-6 md:px-6 laptop:pt-4"}>
            {!isFullBleed && <IssuedPasswordBanner />}
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
