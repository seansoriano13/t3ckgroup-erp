import React from "react";

/**
 * Standard Page Header component to ensure visual consistency across all tabs.
 * Supports a title with an optional gradient on the last word, a description,
 * and optional children (actions/buttons) on the right side.
 *
 * `compact` is the same header for full-bleed working screens (the SOR
 * Register), where height is the scarce thing: one row, a smaller title, no
 * bottom air. Same red last word, same rule beneath, same slot for actions —
 * only the density changes, so the screen still reads as part of the family.
 */
const PageHeader = ({
  title,
  description,
  children,
  showGradient = true,
  className = "",
  lastWordColor = "text-primary",
  compact = false,
}) => {
  // Split title to apply gradient to the last part
  const titleWords = title.split(" ");
  const lastWord =
    titleWords.length > 1 ? titleWords[titleWords.length - 1] : "";
  const firstPart =
    titleWords.length > 1 ? titleWords.slice(0, -1).join(" ") : title;

  return (
    <div
      className={`flex justify-between border-b border-border ${
        compact
          ? "items-center gap-3 pb-3"
          : "flex-col md:flex-row md:items-end gap-4 pb-6"
      } ${className}`}
    >
      <div className={compact ? "min-w-0" : "space-y-1"}>
        <h1
          className={`font-black text-foreground tracking-tight flex flex-wrap items-center gap-x-2 ${
            compact ? "text-xl md:text-2xl" : "text-3xl md:text-4xl"
          }`}
        >
          <span>{firstPart}</span>
          {lastWord && showGradient ? (
            <span className="text-primary pr-1">{lastWord}</span>
          ) : lastWord ? (
            <span className={`${lastWordColor}`}>{lastWord}</span>
          ) : null}
        </h1>
        {description && (
          <p
            className={`text-muted-foreground font-medium max-w-2xl ${
              compact ? "text-xs" : "text-sm md:text-base"
            }`}
          >
            {description}
          </p>
        )}
      </div>
      {children && (
        <div
          className={`flex items-center gap-3 ${
            compact ? "min-w-0" : "shrink-0 flex-wrap"
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
