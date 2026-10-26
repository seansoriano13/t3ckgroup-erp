import { useMemo, useRef, useState } from "react";
import { activeMentionQuery } from "../../utils/mentions";

// Eight rows overflow the list's own 200px cap, so the scroll container below
// finally does something. A cap low enough to fit without scrolling silently
// hides most of the company, which is the failure this number exists to avoid.
const MAX_SUGGESTIONS = 8;

/**
 * A textarea that recognises `@` and offers people to mention.
 *
 * The mentioned people are tracked as ids rather than parsed back out of the
 * text on save: a name typed by hand, or edited after picking, would otherwise
 * silently notify nobody — and a notification that sometimes fires is worse
 * than one that never does. `value` stays plain text so everything that
 * already reads a note keeps working; `mentions` rides alongside it.
 *
 * The list opens upward. This sits at the bottom of a panel inside a scrolling
 * modal, and a downward list would render past the fold.
 */

export default function MentionTextarea({
  value,
  onChange,
  people = [],
  mentions = [],
  onMentionsChange,
  placeholder,
  rows = 2,
  className = "",
  containerClassName = "w-full",
  onPaste,
  disabled,
  maxLength,
  onEnterSubmit,
  autoFocus,
  "aria-label": ariaLabel,
}) {
  const areaRef = useRef(null);
  const [query, setQuery] = useState(null);
  const [active, setActive] = useState(0);

  // The roster arrives in whatever order Postgres returned it, so an unsorted
  // list made a bare `@` open on an arbitrary handful of the company. Sorting
  // by name gives the same people the same places every time, which is what
  // makes the list scannable rather than something to read end to end.
  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.token.trim().toLowerCase();
    const pool = q
      ? people.filter((p) => p.name.toLowerCase().includes(q))
      : people;
    return [...pool]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, MAX_SUGGESTIONS);
  }, [people, query]);

  const isOpen = !!query && matches.length > 0;

  const sync = (text, caret) => {
    const next = activeMentionQuery(text, caret);
    setQuery(next);
    setActive(0);
  };

  const insert = (person) => {
    if (!query) return;
    const before = value.slice(0, query.at);
    const after = value.slice(query.at + query.token.length + 1);
    const text = `${before}@${person.name} ${after}`;
    onChange(text);
    if (!mentions.some((m) => m.id === person.id)) {
      onMentionsChange([...mentions, { id: person.id, name: person.name }]);
    }
    setQuery(null);
    setTimeout(() => {
      if (areaRef.current) {
        areaRef.current.focus();
        const pos = before.length + person.name.length + 2;
        areaRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  return (
    <div className={`relative ${containerClassName}`}>
      {isOpen && (
        <ul
          role="listbox"
          aria-label="Mention someone"
          className="popover-enter absolute bottom-full left-0 z-[60] mb-2 max-h-[200px] w-full overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-2xl"
        >
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => insert(p)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors ${
                  i === active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <span className="truncate">{p.name}</span>
                {p.subDepartment && (
                  <span className="ml-auto shrink-0 text-[10px] font-bold text-muted-foreground/70">
                    {p.subDepartment}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        ref={areaRef}
        rows={rows}
        value={value}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
        maxLength={maxLength}
        onPaste={onPaste}
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target.value, e.target.selectionStart);
        }}
        onClick={(e) => sync(e.target.value, e.target.selectionStart)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            sync(e.target.value, e.target.selectionStart);
          }
        }}
        onKeyDown={(e) => {
          if (!isOpen) {
            if (e.key === "Enter" && !e.shiftKey && onEnterSubmit) {
              e.preventDefault();
              onEnterSubmit(e);
            }
            return;
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" || e.key === "Tab") {
            // Enter picks the highlighted person rather than posting the note —
            // the list being open is the signal that a mention is in progress.
            e.preventDefault();
            insert(matches[active]);
          } else if (e.key === "Escape") {
            e.preventDefault();
            setQuery(null);
          }
        }}
        onBlur={() => setTimeout(() => setQuery(null), 120)}
        className={className}
      />
    </div>
  );
}

/**
 * Renders a posted note with its mentions picked out.
 *
 * Highlights only the names actually recorded on the note, so typing "@someone"
 * by hand reads as plain text — which is honest, because nobody was notified.
 */
export function NoteText({ content, mentions = [], className = "", onMentionClick }) {
  if (!content) return null;
  const names = (mentions || []).map((m) => m.name).filter(Boolean);
  if (names.length === 0) return <p className={className}>{content}</p>;

  const escaped = names
    .slice()
    .sort((a, b) => b.length - a.length) // longest first: "Ana Reyes" before "Ana"
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const parts = content.split(new RegExp(`(@(?:${escaped}))`, "g"));

  return (
    <p className={className}>
      {parts.map((part, i) => {
        if (/^@/.test(part) && names.some((n) => `@${n}` === part)) {
          const rawName = part.slice(1);
          const mentionObj = (mentions || []).find((m) => m.name === rawName);
          if (onMentionClick) {
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onMentionClick(mentionObj || { name: rawName });
                }}
                className="inline-flex items-center rounded bg-primary/10 hover:bg-primary/20 px-1 font-semibold text-primary transition-colors cursor-pointer"
                title={`Click to mention @${rawName}`}
              >
                {part}
              </button>
            );
          }
          return (
            <span
              key={i}
              className="rounded bg-primary/10 px-1 font-semibold text-primary"
            >
              {part}
            </span>
          );
        }
        return part;
      })}
    </p>
  );
}
