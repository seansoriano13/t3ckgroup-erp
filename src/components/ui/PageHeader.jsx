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
  // Split title to colour the last word. A one-word title is its own last
  // word, so it takes the accent too (#903: Canvasses, IPAS, Transmittals).
  const titleWords = title.split(" ");
  const lastWord = titleWords[titleWords.length - 1];
  const firstPart = titleWords.slice(0, -1).join(" ");

  return (
    <div
      className={`flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:flex-wrap md:items-center md:justify-between ${className}`}
    >
      {/* The title column takes what the actions leave, so the description
          wraps before the actions do. */}
      <div className="min-w-0 md:min-w-64 md:flex-1">
        <h1 className="flex flex-wrap items-center gap-x-2 text-xl font-black tracking-tight text-foreground md:text-2xl">
          {firstPart && <span>{firstPart}</span>}
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
      {/* `data-page-actions`: a plain (default-variant) Button placed straight
          in here is the Page's main action and turns primary red (index.css),
          so a new Page gets a red New button with nothing extra. Outline,
          ghost and pill controls beside it keep their own look. */}
      {children && (
        <div data-page-actions className="flex min-w-0 flex-wrap items-center gap-3">
          {children}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
