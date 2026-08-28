import { useEffect, useRef } from "react"
import { toast } from "react-hot-toast"
import { RefreshCw, Sparkles, X } from "lucide-react"

const CHECK_INTERVAL_MS = 2 * 60 * 1000 // 2 minutes
const TOAST_ID = "app-version-update"

export function VersionUpdateNotifier() {
  const hasNotifiedRef = useRef(false)

  useEffect(() => {
    // In development mode or if __APP_VERSION__ is missing, skip version check
    if (import.meta.env.DEV || typeof __APP_VERSION__ === "undefined") {
      return
    }

    const checkForUpdate = async () => {
      if (hasNotifiedRef.current) return

      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        })

        if (!response.ok) return

        const data = await response.json()

        if (data?.version && data.version !== __APP_VERSION__) {
          hasNotifiedRef.current = true

          toast.custom(
            (t) => (
              <div
                className={`${
                  t.visible
                    ? "animate-in fade-in slide-in-from-top-4"
                    : "animate-out fade-out slide-out-to-top-4 opacity-0"
                } bg-card text-card-foreground shadow-2xl rounded-2xl p-4 flex flex-col gap-3 min-w-[340px] max-w-[440px] border border-primary/30 ring-1 ring-primary/20 pointer-events-auto transition-all duration-300`}
              >
                <div className="flex items-start gap-3.5">
                  <div className="bg-primary/10 text-primary p-2.5 rounded-xl border border-primary/20 shrink-0">
                    <Sparkles size={22} className="animate-pulse" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-[15px] text-foreground tracking-tight">
                        New Update Available
                      </span>
                      <button
                        onClick={() => toast.dismiss(t.id)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted/60 transition-colors"
                        title="Dismiss"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="text-xs font-medium text-muted-foreground leading-relaxed mt-1.5 space-y-2">
                      <p>
                        A new version of the app has been deployed. Reload to update now.
                      </p>
                      {data?.changes && data.changes.length > 0 && (
                        <div className="bg-muted/50 p-2.5 rounded-lg border border-border/50">
                          <span className="font-bold text-[10px] uppercase tracking-wider text-foreground mb-1 block">
                            What's New
                          </span>
                          <ul className="list-disc pl-3 space-y-0.5 text-foreground/80 text-[11px]">
                            {data.changes.map((change, i) => (
                              <li key={i}>{change}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => toast.dismiss(t.id)}
                    className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-muted-foreground hover:bg-muted/80 transition-all"
                  >
                    Later
                  </button>
                  <button
                    onClick={() => window.location.reload()}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-xl text-xs font-extrabold transition-all shadow-[0_4px_12px_-2px_rgba(var(--primary-rgb),0.3)] flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    Update Now
                  </button>
                </div>
              </div>
            ),
            {
              id: TOAST_ID,
              duration: Infinity,
              position: "top-center",
            },
          )
        }
      } catch {
        // Silently swallow network / parsing errors during background check
      }
    }

    // Run initial check after a short delay
    const initialTimer = setTimeout(checkForUpdate, 10000)

    // Periodic interval
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS)

    // Check when user returns to tab
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        checkForUpdate()
      }
    }

    window.addEventListener("focus", handleVisibilityOrFocus)
    document.addEventListener("visibilitychange", handleVisibilityOrFocus)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(interval)
      window.removeEventListener("focus", handleVisibilityOrFocus)
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus)
    }
  }, [])

  return null
}
