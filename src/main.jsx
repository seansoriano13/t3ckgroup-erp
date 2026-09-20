import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { Routes } from "@generouted/react-router"
import { AuthProvider } from "./context/AuthContext"
import { Toaster, resolveValue } from "react-hot-toast"
import { GoogleOAuthProvider } from "@react-oauth/google"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ErrorBoundary } from "react-error-boundary"
import { useTheme } from "./hooks/useTheme"
import { CustomToast } from "./components/ui/CustomToast"
import { VersionUpdateNotifier } from "./components/VersionUpdateNotifier"
import { StagingBanner } from "./components/StagingBanner"
import { Button } from "@/components/ui/button";

// Auto-reload when dynamic chunk imports fail due to new deployments
window.addEventListener("vite:preloadError", () => {
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true, // Instantly updates when they click back into browser
      refetchOnReconnect: "always",
      staleTime: 1000 * 60 * 15, // Considers data "fresh" for 15 minutes
      refetchInterval: false, // 👈 DISABLED: Polling is the primary cause of high egress. Rely on manual refresh or Realtime.
      retry: 2,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    },
  },
})

// eslint-disable-next-line react-refresh/only-export-components
function GlobalErrorFallback({ error, resetErrorBoundary }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-mauve-1 text-foreground p-6">
      <div className="bg-mauve-2 border border-red-a5 p-8 rounded-2xl shadow-2xl max-w-lg text-center">
        <h2 className="text-2xl font-black text-red-9 mb-2">System Error</h2>
        <p className="text-mauve-10 mb-6">
          The application encountered an unexpected issue.
        </p>
        <pre className="text-xs bg-mauve-1 border border-mauve-4 p-4 rounded-xl text-red-11 mb-6 overflow-x-auto text-left">
          {error.message}
        </pre>
        <Button
          onClick={resetErrorBoundary}
          variant="default"
        >
          Reload Dashboard
        </Button>
      </div>
    </div>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
function ThemeApplier({ children }) {
  useTheme()
  return children
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary FallbackComponent={GlobalErrorFallback}>
      <QueryClientProvider client={queryClient}>
        <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
          <AuthProvider>
            <ThemeApplier>
              {/* aria-live marks this wrapper (and everything in it) as a live
                  region, which is the one thing that keeps a modal dialog from
                  marking it aria-hidden/inert when it opens — without it, a
                  toast raised while a dialog is open is stuck non-interactive
                  for the dialog's whole lifetime, since the app's single
                  Toaster is mounted once at boot, long before any toast (or
                  its own aria-live) exists for the dialog to notice (#175). */}
              <div aria-live="polite" aria-atomic="false" className="contents">
                <Toaster
                  position="top-center"
                  reverseOrder={false}
                  gutter={12}
                  containerStyle={{ zIndex: 99999999 }}
                  toastOptions={{ duration: 3000 }}
                >
                  {(t) =>
                    t.type === "custom" ? (
                      resolveValue(t.message, t)
                    ) : (
                      <CustomToast t={t} />
                    )
                  }
                </Toaster>
              </div>
              <VersionUpdateNotifier />
              <StagingBanner />
              <Routes />
            </ThemeApplier>
          </AuthProvider>
        </GoogleOAuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
