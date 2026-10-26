import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ListTodo } from "lucide-react";
import { opportunityService } from "../../services/opportunityService";
import { stageFieldService } from "../../services/stageFieldService";
import { SOR_STAGE_FIELDS } from "../../constants/stageFields";
import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";
import { SelectField } from "@/components/ui/SelectField";

/**
 * A Stage's own small form, under its checklist — never checklist rows
 * (issue #203, story 23). An `sor`-source field writes straight through the
 * SOR's own single-field save (#199's `saveRecordField`, wired in here as
 * `onSaveField`), so a Stage Field never opens a second way to set the same
 * column. A `custom` field is kept per Stage Visit: it renders blank on a
 * fresh (or looped-back) visit, with the previous visit's value shown only
 * for reference (story 26) — never pre-filled, because pre-filling would
 * silently carry stale evidence forward across the very loop that exists to
 * surface it.
 */
export default function StageFieldsForm({ opportunity, fields, currentVisitId, actorId, onSaveField, onChanged }) {
  const queryClient = useQueryClient();
  const opportunityId = opportunity?.id;
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(null);

  const { data: currentValues = {} } = useQuery({
    queryKey: ["stageFieldValues", currentVisitId],
    queryFn: () => stageFieldService.getValuesForVisit(currentVisitId),
    enabled: !!currentVisitId,
  });

  const { data: previousVisitId = null } = useQuery({
    queryKey: ["previousStageVisitId", opportunityId, opportunity?.flow_stage_id],
    queryFn: () => opportunityService.getPreviousStageVisitId(opportunityId, opportunity.flow_stage_id),
    enabled: !!opportunityId && !!opportunity?.flow_stage_id,
  });

  const { data: previousValues = {} } = useQuery({
    queryKey: ["stageFieldValues", previousVisitId],
    queryFn: () => stageFieldService.getValuesForVisit(previousVisitId),
    enabled: !!previousVisitId,
  });

  // A field just saved this visit shows as satisfied rather than as an empty
  // input the salesperson has to re-fill on every render.
  useEffect(() => {
    setDraft({});
  }, [currentVisitId]);

  const saveCustomMutation = useMutation({
    mutationFn: ({ field, value }) =>
      stageFieldService.saveValue(
        { opportunityId, stageVisitId: currentVisitId, fieldId: field.id, value },
        actorId,
      ),
    onSuccess: (_data, { field }) => {
      queryClient.invalidateQueries({ queryKey: ["stageFieldValues", currentVisitId] });
      onChanged?.();
      toast.success(`${field.label} saved.`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (!fields || fields.length === 0) return null;

  const handleSave = async (field) => {
    const value = draft[field.id];
    if (value === undefined || value === "") return;
    if (field.source === "sor") {
      if (!onSaveField) return;
      setSaving(field.id);
      try {
        await onSaveField(field.sor_field, value);
        setDraft((p) => ({ ...p, [field.id]: "" }));
        toast.success(`${field.label} saved.`);
      } catch (err) {
        toast.error(err.message);
      } finally {
        setSaving(null);
      }
    } else {
      saveCustomMutation.mutate({ field, value });
      setDraft((p) => ({ ...p, [field.id]: "" }));
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/50 p-4">
      <p className="mb-3 text-label font-bold tracking-widest text-muted-foreground uppercase">
        <ListTodo size={11} className="mr-1 inline" /> This Stage's fields
      </p>
      <div className="space-y-3">
        {fields.map((field) => {
          const isSor = field.source === "sor";
          const savedThisVisit = isSor ? null : currentValues[field.id];
          const previousValue = isSor ? null : previousValues[field.id];
          const value = draft[field.id] ?? "";
          const isSaving = isSor
            ? saving === field.id
            : saveCustomMutation.isPending && saveCustomMutation.variables?.field.id === field.id;

          return (
            <div key={field.id} className="space-y-1">
              <FieldBox label={<>{field.label}
                {field.is_required && (
                  <span className="text-label font-black uppercase text-amber-600 dark:text-amber-400">
                    Required
                  </span>
                )}</>} />
              {field.help && <p className="text-[11px] text-muted-foreground">{field.help}</p>}

              {savedThisVisit !== null && savedThisVisit !== undefined && savedThisVisit !== "" ? (
                <p className="text-xs text-green-9">Saved this visit: {String(savedThisVisit)}</p>
              ) : (
                <>
                  {previousValue !== null && previousValue !== undefined && previousValue !== "" && (
                    <p className="text-[11px] italic text-muted-foreground">
                      Last visit: {String(previousValue)} (for reference only)
                    </p>
                  )}
                  <div className="flex items-center gap-2 max-w-sm">
                    {field.source === "custom" && field.field_type === "choice" ? (
                      <SelectField
                        aria-label={field.label}
                        value={value}
                        onChange={(next) => setDraft((p) => ({ ...p, [field.id]: next }))}
                        options={(field.options || []).map((opt) => ({ value: opt, label: opt }))}
                        placeholder="Select…"
                        className="w-full"
                      />
                    ) : (
                      <Input
                        aria-label={field.label}
                        type={
                          isSor
                            ? SOR_STAGE_FIELDS[field.sor_field]?.inputType || "text"
                            : field.field_type === "number"
                              ? "number"
                              : field.field_type === "date"
                                ? "date"
                                : "text"
                        }
                        value={value}
                        onChange={(e) => setDraft((p) => ({ ...p, [field.id]: e.target.value }))}
                        placeholder={`Enter ${field.label.toLowerCase()}`}
                        containerClassName="flex w-full" className="h-8 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm"
                      />
                    )}
                    <Button
                      type="button"
                      disabled={isSaving || !value}
                      onClick={() => handleSave(field)}
                      className="shrink-0 px-3 text-[11px]"
                    >
                      {isSaving ? "…" : "Save"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
