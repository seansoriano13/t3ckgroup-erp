import { getStatusTheme } from "../constants/status";

export default function StatusBadge({
  status,
  label,
  theme: themeOverride,
  children,
  className = "",
  title,
}) {
  // `theme` bypasses the status→theme lookup entirely — for a caller that
  // already knows the theme it wants (a flow Stage's own color or role, which
  // has no crm_pipeline_stages code to look up).
  const theme = themeOverride || getStatusTheme(status);

  // Text uses the Radix step that clears 4.5:1 on the card (mauve-2 #faf9fb,
  // light theme). Radix swaps the steps for dark mode, so no dark: variants.
  // Green, amber and orange fail at step 11, so their text uses step 12.
  const themeStyles = {
    green: "bg-card text-green-12 border-green-7",
    amber: "bg-card text-amber-12 border-amber-7",
    blue: "bg-card text-blue-11 border-blue-7",
    red: "bg-card text-red-11 border-red-7",
    violet: "bg-card text-violet-11 border-violet-7",
    orange: "bg-card text-orange-12 border-orange-7",
    mauve: "bg-card text-muted-foreground border-mauve-5",
  };

  const appliedStyle = themeStyles[theme] || themeStyles.mauve;
  const content = children || label || (status ? String(status).replace(/_/g, " ") : "UNKNOWN");

  return (
    <span
      title={title}
      className={`inline-flex items-center justify-center h-5 px-2 text-label font-bold uppercase tracking-wider border rounded-full whitespace-nowrap leading-none shrink-0 max-w-full ${appliedStyle} ${className}`}
    >
      {/* A plain-text badge ends in an ellipsis when its column is narrower than
          its words; a badge with an icon keeps its own children as they are. */}
      {typeof content === "string" ? <span className="min-w-0 truncate">{content}</span> : content}
    </span>
  );
}
