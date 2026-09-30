/**
 * The one empty state: muted icon, title, one line. No box, no dashed border.
 * (DESIGN.md "Pages → Empty state".)
 */
export default function EmptyState({ icon: Icon, title, description, className = "" }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 py-16 text-center text-muted-foreground ${className}`}
    >
      {Icon && <Icon size={28} className="opacity-40" />}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs leading-relaxed">{description}</p>}
    </div>
  );
}
