/**
 * Placeholder for #299's one-line task row (title, member avatars, parts
 * done, due date, expand-to-members). Exists now so #298's Now tab lift and
 * #299's redesign share the same import path.
 */
export default function TaskRow({ title }) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs text-muted-foreground">
      {title}
    </div>
  );
}
