import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Spinner from "./ui/Spinner";
import { brochureLibraryService, brochureToAttachment } from "../services/brochureLibraryService";

/**
 * The "Brochure library" source of the shared file picker. Collapsed to a
 * single button; opened, it searches brochures by brand, model or type and
 * hands the pick back as a linked attachment (never an upload).
 */
export default function BrochureLibraryPicker({ onPick, disabled = false, compact = false }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");

  const results = useQuery({
    queryKey: ["brochureLibrary", query],
    queryFn: () => brochureLibraryService.search(query),
    enabled: open && query.length >= 2,
    staleTime: 60_000,
  });

  if (!open) {
    return (
      <Button
        type="button"
        variant={compact ? "ghost" : "outline"}
        size={compact ? "xs" : undefined}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={compact ? "gap-1 text-[11px] text-muted-foreground" : "mb-1 w-full justify-start gap-1.5 text-sm"}
      >
        <BookOpen size={compact ? 12 : 14} /> Brochure library
      </Button>
    );
  }

  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-border p-2">
      <div className="flex gap-1.5">
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setQuery(text.trim());
            }
          }}
          placeholder="Brand, model or type"
          aria-label="Search brochures"
        />
        <Button type="button" size="icon" variant="outline" aria-label="Search" onClick={() => setQuery(text.trim())}>
          <Search size={14} />
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <div className="max-h-48 space-y-0.5 overflow-y-auto">
        {results.isFetching && <Spinner size="sm" />}
        {results.isError && <p className="px-1 text-xs text-destructive">{results.error.message}</p>}
        {results.data?.length === 0 && !results.isFetching && (
          <p className="px-1 py-2 text-center text-xs text-muted-foreground">No brochures found.</p>
        )}
        {results.data?.map((brochure) => (
          <Button
            key={brochure.url}
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              onPick(brochureToAttachment(brochure));
              setOpen(false);
            }}
            className="h-auto w-full justify-start truncate rounded-lg px-2.5 py-1.5 text-left text-sm"
          >
            {brochure.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
