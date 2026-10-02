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

  const themeStyles = {
    green: "bg-card text-green-600 dark:text-green-400 border-green-400",
    amber: "bg-card text-amber-600 dark:text-amber-400 border-amber-400",
    blue: "bg-card text-blue-600 dark:text-blue-400 border-blue-400",
    red: "bg-card text-red-600 dark:text-red-400 border-red-400",
    violet: "bg-card text-violet-600 dark:text-violet-400 border-violet-400",
    orange: "bg-card text-orange-600 dark:text-orange-400 border-orange-400",
    mauve: "bg-card text-muted-foreground border-mauve-5",
  };

  const appliedStyle = themeStyles[theme] || themeStyles.mauve;

  return (
    <span
      title={title}
      className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-full whitespace-nowrap ${appliedStyle} ${className}`}
    >
      {children || label || (status ? String(status).replace(/_/g, " ") : "UNKNOWN")}
    </span>
  );
}
