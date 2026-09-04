import { useEffect } from "react"
import { AlertTriangle } from "lucide-react"

export function StagingBanner() {
  const isStaging =
    import.meta.env.MODE === "staging" ||
    import.meta.env.VITE_APP_ENV === "staging" ||
    window.location.hostname.includes("staging")

  useEffect(() => {
    if (isStaging) {
      document.title = `[STAGING] ${document.title.replace("[STAGING] ", "")}`
      
      // Optional: Swap favicon to something distinct
      let link = document.querySelector("link[rel~='icon']")
      if (!link) {
        link = document.createElement("link")
        link.rel = "icon"
        document.head.appendChild(link)
      }
      // Assuming you have an alternate favicon, else just changing title is highly effective
      // link.href = "/favicon-staging.svg"; 
    }
  }, [isStaging])

  if (!isStaging) return null

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
          backgroundColor: "#f97316", // Tailwind orange-500
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
        STAGING - TEST DATA ONLY
        <AlertTriangle size={14} strokeWidth={3} />
      </div>
    </div>
  )
}
