import React from "react";
import { CheckCircle2 } from "lucide-react";

export default function Avatar({
  name,
  src,
  size = "md", // xxs, xs, sm, md, lg, xl
  className = "",
  isSelected = false,
  onClick,
  showCheckOnSelect = false,
  title,
  ...props
}) {
  const sizeClasses = {
    xxs: "w-4 h-4 text-[8px] rounded",
    xs: "w-5 h-5 text-[9px] rounded-full",
    sm: "w-6 h-6 text-[10px] rounded-lg",
    md: "w-8 h-8 text-xs rounded-xl",
    lg: "w-10 h-10 text-sm rounded-full",
    xl: "w-12 h-12 text-base rounded-2xl",
  };

  const isSelectedClasses = isSelected
    ? "border-mauve-8 bg-mauve-2 text-mauve-11 shadow-[0_0_15px_rgba(246,215,242,0.15)] scale-105"
    : "";

  const cursorClass = onClick
    ? "cursor-pointer hover:scale-105 hover:shadow-md"
    : "";

  // If className doesn't contain a background color, we provide a default
  const hasBg = className.includes("bg-");
  const defaultBg =
    !hasBg && !isSelected ? "bg-muted text-muted-foreground border-border" : "";

  const [imgError, setImgError] = React.useState(false);
  const initials = name
    ? name
        .split(" ")
        .filter(Boolean)
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "?";

  return (
    <div
      onClick={onClick}
      title={title || name}
      className={`relative shrink-0 flex items-center justify-center font-bold uppercase transition-all duration-300 border overflow-hidden ${sizeClasses[size] || sizeClasses.md} ${isSelectedClasses} ${defaultBg} ${cursorClass} ${className}`}
      {...props}
    >
      {src && !isSelected && !imgError ? (
        <img
          src={src}
          alt={name || "Avatar"}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      ) : (
        <>
          {showCheckOnSelect && (
            <div
              className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
                isSelected
                  ? "scale-100 opacity-100 rotate-0"
                  : "scale-50 opacity-0 -rotate-90"
              }`}
            >
              <CheckCircle2
                size={
                  size === "xs" || size === "xxs" || size === "sm"
                    ? 14
                    : size === "md"
                      ? 18
                      : 24
                }
                className="text-mauve-10"
              />
            </div>
          )}
          <div
            className={`absolute inset-0 flex items-center justify-center transition-all duration-300 ${
              isSelected && showCheckOnSelect
                ? "scale-50 opacity-0 rotate-90"
                : "scale-100 opacity-100 rotate-0"
            }`}
          >
            {initials}
          </div>
        </>
      )}
    </div>
  );
}
