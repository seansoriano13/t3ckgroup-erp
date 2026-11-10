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
  // Every Stage color the flow canvas offers (flow_stages.color) needs its
  // classes spelled out here: Tailwind only ships classes it finds written in
  // full, so a color built from a variable would render gray (SOR list, 2026-10-22).
  const themeStyles = {
    green: "bg-card text-green-12 border-green-7",
    amber: "bg-card text-amber-12 border-amber-7",
    blue: "bg-card text-blue-11 border-blue-7",
    red: "bg-card text-red-11 border-red-7",
    violet: "bg-card text-violet-11 border-violet-7",
    orange: "bg-card text-orange-12 border-orange-7",
    mauve: "bg-card text-muted-foreground border-mauve-5",
    gray: "bg-card text-gray-11 border-gray-7",
    tomato: "bg-card text-tomato-11 border-tomato-7",
    crimson: "bg-card text-crimson-11 border-crimson-7",
    pink: "bg-card text-pink-11 border-pink-7",
    plum: "bg-card text-plum-11 border-plum-7",
    indigo: "bg-card text-indigo-11 border-indigo-7",
    sky: "bg-card text-sky-11 border-sky-7",
    cyan: "bg-card text-cyan-11 border-cyan-7",
    teal: "bg-card text-teal-11 border-teal-7",
    jade: "bg-card text-jade-11 border-jade-7",
    lime: "bg-card text-lime-12 border-lime-7",
    yellow: "bg-card text-yellow-12 border-yellow-7",
    gold: "bg-card text-gold-12 border-gold-7",
    brown: "bg-card text-brown-11 border-brown-7",
  };

  const appliedStyle = themeStyles[theme] || themeStyles.mauve;
  const content = children || label || (status ? String(status).replace(/_/g, " ") : "UNKNOWN");

  // Plain text is the badge's own text node, so a label wider than its column
  // ends in an ellipsis (text-overflow needs a block-level box, not a flex one).
  // A badge handed children (an icon and a label) stays a flex row.
  const isText = typeof content === "string";
  const shape = isText
    ? "inline-block max-w-full truncate text-center leading-[18px] align-middle"
    : "inline-flex items-center justify-center max-w-full";

  return (
    <span
      title={title}
      className={`${shape} h-5 px-2 text-label font-bold uppercase tracking-wider border rounded-full whitespace-nowrap shrink-0 ${isText ? "" : "leading-none"} ${appliedStyle} ${className}`}
    >
      {content}
    </span>
  );
}
