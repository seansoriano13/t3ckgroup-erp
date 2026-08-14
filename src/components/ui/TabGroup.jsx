/**
 * TabGroup — Unified reusable tab bar component.
 *
 * Props:
 *  tabs       - array of strings OR { value, label, icon?, badge? } objects
 *  activeTab  - currently active value (string)
 *  onChange   - (value: string) => void
 *  variant    - "pill" | "primary" | "underline"  (default: "pill")
 *  size       - "sm" | "md"                       (default: "sm")
 *  className  - optional extra class on the wrapper
 *
 * Variants:
 *  pill      → bg-muted wrapper, bg-card active (group / approvals / broadcast)
 *  primary   → bg-card+border wrapper, bg-primary active (tasks, HR management)
 *  underline → no wrapper bg, border-b-2 active (notification drawer)
 */

import { cn } from "@/lib/utils";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { useId } from "react";

export default function TabGroup({
  tabs = [],
  activeTab,
  onChange,
  variant = "pill",
  size = "sm",
  fullWidth = false,
  className,
  id,
}) {
  const generatedId = useId();
  const groupId = id || generatedId;

  const normalised = tabs.map((t) =>
    typeof t === "string" ? { value: t, label: t } : t,
  );

  // Wrapper classes
  const wrapperCls = cn(
    "flex overflow-x-auto shrink-0 relative [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
    variant === "pill" && "bg-muted p-1 rounded-xl w-fit",
    (variant === "primary" ||
      variant === "success" ||
      variant === "violet" ||
      variant === "red" ||
      variant === "destructive") &&
    "bg-card border border-border p-1 rounded-xl shadow-sm",
    variant === "underline" && "gap-6 border-b border-border",
    fullWidth && "w-full",
    className,
  );

  // Per-button classes
  const btnBase = cn(
    "relative flex items-center justify-center gap-1.5 font-bold whitespace-nowrap transition-all outline-none",
    size === "sm" && "px-4 py-1.5 text-xs",
    size === "md" && "px-4 py-2 text-xs",
    fullWidth && "flex-1",
  );

  const btnActive = {
    pill: "text-foreground",
    primary: "text-primary-foreground",
    success: "text-white",
    violet: "text-white",
    red: "text-white",
    destructive: "text-destructive-foreground",
    underline: "border-b-2 border-mauve-10 text-foreground -mb-px",
  };

  const btnInactive = {
    pill: "text-muted-foreground hover:text-foreground hover:bg-card/30 rounded-lg",
    primary:
      "text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg",
    success:
      "text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg",
    violet:
      "text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg",
    red:
      "text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg",
    destructive:
      "text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg",
    underline:
      "border-b-2 border-transparent text-muted-foreground hover:text-foreground pb-3",
  };

  // Indicator background classes
  const indicatorCls = {
    pill: "bg-card shadow-sm rounded-lg",
    primary: "bg-primary shadow-md shadow-primary/15 rounded-lg",
    success: "bg-green-10 shadow-md shadow-green-9/20 rounded-lg",
    violet: "bg-violet-9 shadow-md shadow-violet-9/20 rounded-lg",
    red: "bg-red-9 shadow-md shadow-red-9/20 rounded-lg",
    destructive: "bg-destructive shadow-md shadow-destructive/15 rounded-lg",
    underline: "", // Handle underline separately if needed, but underline uses border
  };

  return (
    <motion.div layout className={wrapperCls}>
      <AnimatePresence>
        {normalised.map(
          ({
            value,
            label,
            icon: Icon,
            badge,
            activeClass,
            variant: tabVariant,
          }) => {
            const isActive = activeTab === value;
            const currentVariant = tabVariant || variant;
            return (
              <button
                key={value}
                onClick={() => onChange(value)}
                className={cn(
                  btnBase,
                  isActive
                    ? activeClass || btnActive[currentVariant]
                    : btnInactive[currentVariant],
                  variant === "underline" && size === "sm" && "pb-3",
                )}
              >
                {isActive && currentVariant !== "underline" && (
                  <motion.div
                    layoutId={`tab-indicator-${variant}-${groupId}`}
                    className={cn(
                      "absolute inset-0 z-0",
                      indicatorCls[currentVariant],
                    )}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {Icon && <Icon size={14} />}
                  <span>{label}</span>
                  {badge != null && badge > 0 && (
                    <span
                      className={cn(
                        "ml-0.5 text-[10px] px-1.5 py-0.5 rounded-full font-black transition-colors",
                        isActive
                          ? variant === "success"
                            ? "bg-white/20 text-white"
                            : "bg-primary/10 text-primary"
                          : "bg-muted-foreground/20 text-muted-foreground",
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </span>
              </button>
            );
          },
        )}
      </AnimatePresence>
    </motion.div>
  );
}
