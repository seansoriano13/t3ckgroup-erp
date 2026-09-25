import { Button } from "@/components/ui/button";
import { SOR_STAGE_FIELDS } from "../../constants/stageFields";
import { cleanChoiceOptions } from "./choiceOptions";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";
import { SelectField } from "@/components/ui/SelectField";

/**
 * How a Stage field will look on the SOR, drawn from the draft being edited.
 * Shared by the Stage Fields form and the Release Notes deck, so the deck shows
 * the real thing instead of a picture of it.
 */
export default function StageFieldPreview({ draft }) {
  return (
    <div className="rounded-xl border border-dashed border-mauve-7 p-3">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Preview — how this looks on the SOR
      </span>
      <div className="space-y-1 rounded-lg bg-card/60 p-3 outline outline-1 -outline-offset-1 outline-mauve-5">
        <FieldBox label={<>{draft.label.trim() || (draft.source === "sor" ? SOR_STAGE_FIELDS[draft.sorField]?.label : "Untitled field")}
          {draft.isRequired ? (
            <span className="text-[10px] font-black uppercase text-amber-600 dark:text-amber-400">
              Required
            </span>
          ) : (
            <span className="rounded bg-mauve-a3 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11">
              Optional
            </span>
          )}</>} />
        {draft.help?.trim() && (
          <p className="text-[11px] text-muted-foreground">{draft.help.trim()}</p>
        )}
        <div className="mt-1.5 flex max-w-sm items-center gap-2">
          {draft.source === "custom" && draft.fieldType === "choice" ? (
            <SelectField
              disabled
              options={cleanChoiceOptions(draft.options).map((opt) => ({ value: opt, label: opt }))}
              placeholder="Select…"
              className="w-full"
            />
          ) : (
            <Input
              disabled
              type={
                draft.source === "sor"
                  ? SOR_STAGE_FIELDS[draft.sorField]?.inputType || "text"
                  : draft.fieldType === "number"
                    ? "number"
                    : draft.fieldType === "date"
                      ? "date"
                      : "text"
              }
              placeholder={`Enter ${(draft.label.trim() || (draft.source === "sor" ? SOR_STAGE_FIELDS[draft.sorField]?.label : "field") || "field").toLowerCase()}`}
              containerClassName="flex w-full" className="h-8 cursor-not-allowed rounded-md border border-input bg-background/50 px-2.5 py-1 text-xs opacity-90 shadow-sm"
            />
          )}
          <Button
            type="button"
            disabled
            size="sm"
            className="shrink-0 cursor-not-allowed rounded-md bg-mauve-12 px-3 text-[11px] font-medium text-mauve-1 opacity-50 shadow"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
