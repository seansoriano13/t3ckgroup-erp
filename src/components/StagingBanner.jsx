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

  return (
    <div
      className="fixed top-0 right-0 z-[9999999] pointer-events-none"
      style={{
        width: "250px",
        height: "250px",
        overflow: "hidden",
      }}
    >
      <div
        className="absolute flex items-center justify-center gap-2 shadow-xl shadow-black/20"
        style={{
          top: "60px",
          right: "-80px",
          width: "340px",
          transform: "rotate(45deg)",
          backgroundColor: bannerColor,
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 10px, rgba(0,0,0,0.15) 10px, rgba(0,0,0,0.15) 20px)",
          color: "white",
          padding: "6px 0",
          fontWeight: "900",
          fontSize: "11px",
          letterSpacing: "0.5px",
        }}
      >
        <AlertTriangle size={14} strokeWidth={3} />
        {bannerText}
        <AlertTriangle size={14} strokeWidth={3} />
      </div>
    </div>
  )
}
