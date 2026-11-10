import Avatar from "./Avatar";

/**
 * Renders a stack of overlapping avatars (like GitHub's contributor faces).
 *
 * @param {Array<{ id: string, name: string, picture?: string|null }>} people
 * @param {number} max  — max visible avatars before showing a "+N" overflow badge
 * @param {"xxs"|"xs"|"sm"|"md"} size — passed to each Avatar
 * @param {string} className — extra classes on the wrapper
 */
export default function AvatarGroup({ people = [], max = 4, size = "xs", className = "" }) {
  if (!people.length) return null;

  const visible = people.slice(0, max);
  const overflow = people.length - max;

  // Size-based overlap & badge dimensions
  const overlapClass = {
    xxs: "-ml-1.5",
    xs:  "-ml-2",
    sm:  "-ml-2.5",
    md:  "-ml-3",
  }[size] ?? "-ml-2";

  const badgeSizeClass = {
    xxs: "w-4 h-4 text-[7px]",
    xs:  "w-5 h-5 text-[8px]",
    sm:  "w-6 h-6 text-[9px]",
    md:  "w-8 h-8 text-[10px]",
  }[size] ?? "w-5 h-5 text-[8px]";

  return (
    <div className={`flex items-center ${className}`}>
      {visible.map((person, i) => (
        <div
          key={person.id ?? i}
          className={`${i === 0 ? "" : overlapClass} ring-2 ring-card rounded-full`}
          style={{ zIndex: visible.length - i }}
          title={person.name}
          role="img"
          aria-label={person.name}
        >
          <Avatar
            name={person.name}
            src={person.picture ?? undefined}
            size={size}
          />
        </div>
      ))}

      {overflow > 0 && (
        <div
          className={`${overlapClass} ring-2 ring-card rounded-full ${badgeSizeClass} flex items-center justify-center bg-muted border border-border text-muted-foreground font-bold`}
          title={`+${overflow} more`}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
