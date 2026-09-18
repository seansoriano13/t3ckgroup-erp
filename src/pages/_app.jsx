import { Navigate, Outlet, useLocation } from "react-router";
import SideNav from "../components/SideNav";
import { useAuth } from "../context/AuthContext";
import { isResetPasswordPath } from "../lib/recoveryLink";
import ChangelogModal from "../components/ChangelogModal";
import IssuedPasswordBanner from "../components/IssuedPasswordBanner";

import Spinner from "@/components/ui/Spinner";

export default function AppLayout() {
  const { user, isAuthLoading } = useAuth();
  const location = useLocation();

  // Editor screens fill the frame instead of sitting in the centred page
  // column: a canvas that pans and zooms wants every pixel of it, and its own
  // floating toolbar already says what a page header would.
  // `/flow-versions/:id` is the same shape: a read-only Flow Snapshot, panned
  // and zoomed, opened from the version badge on an SOR.
  //
  // `/crm` joins them (issue #206): the register is something you pan or scan
  // across (a board, a large list), not a form. Its Commission pages are
  // ordinary pages and stay centred.
  const isFullBleed =
    location.pathname.startsWith("/super-admin/flow-canvas") ||
    location.pathname.startsWith("/flow-versions/") ||
    (location.pathname.startsWith("/crm") &&
      !location.pathname.startsWith("/crm/commission"));

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
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Spinner size="md" />
          <p className="text-sm font-bold uppercase tracking-widest animate-pulse">
            Loading Portal...
          </p>
        </div>
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
    <div className="flex h-screen bg-mauve-2 font-sans overflow-hidden">
      <SideNav />
      <ChangelogModal />

      <main className="flex-1 flex flex-col min-w-0 bg-background md:my-2 md:mr-2 md:ml-2 md:rounded-2xl border-l md:border border-border shadow-sm overflow-hidden relative z-10 transition-transform">
        {isFullBleed ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <Outlet />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="wrapper py-10 px-4 md:px-6">
              <IssuedPasswordBanner />
              <Outlet />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
