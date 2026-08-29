import { Outlet, useLocation } from "react-router";
import SideNav from "../components/SideNav";
import { useAuth } from "../context/AuthContext";

import Spinner from "@/components/ui/Spinner";

export default function AppLayout() {
  const { user, isAuthLoading } = useAuth();
  const location = useLocation();

  // Editor screens fill the frame instead of sitting in the centred page
  // column: a canvas that pans and zooms wants every pixel of it, and its own
  // floating toolbar already says what a page header would.
  const isFullBleed = location.pathname.startsWith("/super-admin/flow-canvas") || location.pathname.match(/^\/flow-plans\/.+/);

  if (location.pathname === "/login") {
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

  return (
    <div className="flex h-screen bg-mauve-2 font-sans overflow-hidden">
      {user && <SideNav />}

      <main className="flex-1 flex flex-col min-w-0 bg-background md:my-2 md:mr-2 md:ml-2 md:rounded-2xl border-l md:border border-border shadow-sm overflow-hidden relative z-10 transition-transform">
        {isFullBleed ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <Outlet />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <div className="wrapper py-10 px-4 md:px-6">
              <Outlet />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
