import { useEffect, useRef } from "react"
import { toast } from "react-hot-toast"
import { RefreshCw, Sparkles } from "lucide-react"
import { Button } from "./ui/button"

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
                } bg-card text-card-foreground rounded-2xl p-4 flex flex-col gap-3 min-w-[340px] max-w-[440px] border border-border pointer-events-auto transition-all duration-300`}
              >
                <div className="flex items-start gap-3.5">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted border border-border/50 text-foreground shrink-0">
                    <Sparkles size={20} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-[15px] text-foreground tracking-tight">
                      New update available
                    </span>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                      Reload to get the latest version.
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => toast.dismiss(t.id)}
                    className="h-auto px-3.5 py-1.5 rounded-xl text-xs font-semibold text-muted-foreground"
                  >
                    Later
                  </Button>
                  <Button
                    onClick={() => window.location.reload()}
                    className="h-auto px-4 py-2 rounded-xl text-xs font-semibold bg-foreground text-background hover:bg-foreground/90 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw size={14} />
                    Reload
                  </Button>
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
