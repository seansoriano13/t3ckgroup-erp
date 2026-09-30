import React from "react";

/**
 * The Page header: title, description, and the Page's actions on the right.
 * There is one (compact) size — DESIGN.md "Pages → Title". The last word of
 * the title is Signal Red. Rendered by PageShell; a Page does not place it.
 */
const PageHeader = ({
  title,
  description,
  children,
  showGradient = true,
  className = "",
  lastWordColor = "text-primary",
}) => {
  // Split title to colour the last word
  const titleWords = title.split(" ");
  const lastWord =
    titleWords.length > 1 ? titleWords[titleWords.length - 1] : "";
  const firstPart =
    titleWords.length > 1 ? titleWords.slice(0, -1).join(" ") : title;

  return (
    <div
      className={`flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:items-center md:justify-between ${className}`}
    >
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-2 text-xl font-black tracking-tight text-foreground md:text-2xl">
          <span>{firstPart}</span>
          {lastWord && showGradient ? (
            <span className="text-primary pr-1">{lastWord}</span>
          ) : lastWord ? (
            <span className={`${lastWordColor}`}>{lastWord}</span>
          ) : null}
        </h1>
        {description && (
          <p className="max-w-2xl text-xs font-medium text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {children}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
