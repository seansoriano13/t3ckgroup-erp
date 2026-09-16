import { taskTagClasses } from "@/constants/taskTagColors";

export function TagPill({ tag, className = "" }) {
  if (!tag) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${taskTagClasses(tag.color)} ${className}`}
      title={tag.archived_at ? `${tag.name} (archived)` : tag.name}
    >
      {tag.name}
    </span>
  );
}
