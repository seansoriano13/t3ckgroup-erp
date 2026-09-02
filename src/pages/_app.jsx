import { Navigate, Outlet, useLocation } from "react-router";
import SideNav from "../components/SideNav";
import { useAuth } from "../context/AuthContext";

import Spinner from "@/components/ui/Spinner";

export default function AppLayout() {
  const { user, isAuthLoading } = useAuth();
  const location = useLocation();

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

      <main className="flex-1 flex flex-col min-w-0 bg-background md:my-2 md:mr-2 md:ml-2 md:rounded-2xl border-l md:border border-border shadow-sm overflow-hidden relative z-10 transition-transform">
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="wrapper py-10 px-4 md:px-6">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
