import React from "react";

/**
 * Standardized container for all dashboard pages.
 * Ensures consistent max-width and vertical spacing. The side gutter belongs to
 * the app frame's `wrapper` (one gutter, not two).
 *
 * `fill` is for full-bleed routes (no wrapper around the page): the container
 * takes the app frame's height, so a body inside it can scroll on its own.
 */
export default function PageContainer({
  children,
  className = "",
  maxWidth = "7xl", // 4xl, 5xl, 6xl, 7xl, full
  spaceY = "6", // 4, 6, 8, 10
  fill = false,
}) {
  const maxWidthClass =
    {
      "4xl": "max-w-4xl",
      "5xl": "max-w-5xl",
      "6xl": "max-w-6xl",
      "7xl": "max-w-7xl",
      full: "max-w-full",
    }[maxWidth] || "max-w-7xl";

  const spaceYClass =
    {
      4: "space-y-4",
      6: "space-y-6",
      8: "space-y-8",
      10: "space-y-10",
    }[spaceY] || "space-y-6";

  // No wrapper surrounds a full-bleed route, so a filled container carries its
  // own top padding, and phones use the same 16px gutter as other pages (the top bar sits above).
  const boxClass = fill
    ? "flex h-full min-h-0 flex-col px-4 pt-3 pb-4 md:px-6"
    : "pb-10";

  return (
    <div className={`mx-auto ${maxWidthClass} ${spaceYClass} ${boxClass} ${className}`}>
      {children}
    </div>
  );
}
