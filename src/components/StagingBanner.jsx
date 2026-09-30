import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"
import { isStaging, isLocal } from "@/lib/appEnv"

export function StagingBanner() {
  useEffect(() => {
    if (isStaging) {
      document.title = `[STAGING] ${document.title.replace("[STAGING] ", "").replace("[LOCAL] ", "")}`
    } else if (isLocal) {
      document.title = `[LOCAL] ${document.title.replace("[STAGING] ", "").replace("[LOCAL] ", "")}`
    }
  }, [isStaging, isLocal])

  if (!isStaging && !isLocal) return null

  const bannerText = isStaging ? "STAGING - TEST DATA ONLY" : "LOCAL - DEVELOPMENT"
  const bannerColor = isStaging ? "#f97316" : "#22c55e" // orange-500 vs green-500

  // A strip along the top edge with a small centred tab, not a corner ribbon:
  // every Page's main action sits top right (DESIGN.md "Main action"), and a
  // ribbon there covered it. The strip fits in the app frame's top margin.
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[9999999] flex flex-col items-center">
      <div className="h-[3px] w-full" style={{ backgroundColor: bannerColor }} />
      <div
        className="flex items-center gap-1.5 rounded-b-md px-2.5 py-0.5 text-[10px] font-black tracking-wide text-white shadow-sm"
        style={{ backgroundColor: bannerColor }}
      >
        <AlertTriangle size={11} strokeWidth={3} />
        {bannerText}
      </div>
    </div>
  )
}
