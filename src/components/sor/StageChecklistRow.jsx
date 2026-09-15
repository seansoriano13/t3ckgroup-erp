import { CheckCircle2, Circle, Paperclip, ListChecks, UserCheck, Square, CheckSquare, UserPlus, FolderOpen } from "lucide-react";
import Avatar from "../Avatar";
import { CONDITION_KINDS, CONDITION_STATUS } from "../../constants/stageGate";
import { formatDate } from "../../utils/formatDate";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList, FilterTrigger } from "../ui/FilterDropdown";
import { acceptsLabel } from "../../utils/attachments";

/** PO Date and Expected Award Date are dates; every other writable field is text. */
const DATE_FIELDS = new Set(["po_date", "expected_award_date"]);

const KIND_LABELS = {
  [CONDITION_KINDS.ATTACHMENT]: "Attachment",
  [CONDITION_KINDS.FIELD]: "Field on record",
  [CONDITION_KINDS.TICKBOX]: "Self-certified",
  [CONDITION_KINDS.ASSIGNMENT]: "Assignment",
};

const KIND_ICONS = {
  [CONDITION_KINDS.ATTACHMENT]: Paperclip,
  [CONDITION_KINDS.FIELD]: ListChecks,
  [CONDITION_KINDS.TICKBOX]: CheckSquare,
  [CONDITION_KINDS.ASSIGNMENT]: UserCheck,
};

/**
 * One row of the Stage Checklist — what a single condition looks like on an
 * SOR: its status, and whatever the salesperson needs to satisfy it.
 *
 * Issue #203, story 3: this same component is what the condition form's live
 * preview renders — fed a sample condition and `isPreview` so nothing here
 * fires a mutation. Extracted out of `StageChecklist.jsx` (which owns the
 * live mutations and state and passes them down) so the two call sites can
 * never quietly drift into two different-looking rows.
 */
export default function StageChecklistRow({
  condition,
  status,
  satisfiedBy,
  satisfiedAt,
  employees = [],
  isPreview = false,
  // Field on record
  fieldValue = "",
  onFieldChange,
  onSaveField,
  savingField = false,
  // Tickbox
  onTick,
  tickDisabled = false,
  // Attachment
  onUpload,
  onPickExisting,
  uploading = false,
  // Assignment
  assignmentValue = null,
  onAssignmentChange,
  onAssign,
  assignPending = false,
}) {
  const Icon = KIND_ICONS[condition.kind] || Circle;
  const isSatisfied = status === CONDITION_STATUS.SATISFIED;
  const isTickable = !isSatisfied && condition.kind === CONDITION_KINDS.TICKBOX;
  const who = employees.find((e) => e.id === satisfiedBy)?.name || null;

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background px-3 py-2.5">
      <button
        type="button"
        disabled={isPreview || !isTickable || tickDisabled}
        onClick={() => !isPreview && isTickable && onTick?.(condition)}
        aria-label={isTickable ? `Certify ${condition.label}` : undefined}
        className={
          isSatisfied
            ? "mt-0.5 shrink-0 text-green-9"
            : isTickable
              ? "mt-0.5 shrink-0 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              : "mt-0.5 shrink-0 text-muted-foreground/40"
        }
      >
        {isSatisfied ? (
          <CheckCircle2 size={17} />
        ) : isTickable ? (
          <Square size={17} />
        ) : (
          <Circle size={17} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={
              isSatisfied
                ? "text-sm font-semibold text-foreground line-through decoration-muted-foreground/40"
                : "text-sm font-semibold text-foreground"
            }
          >
            {condition.label || "Untitled condition"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
            <Icon size={10} />
            {KIND_LABELS[condition.kind] || condition.kind}
          </span>
          {!condition.is_required && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
              Optional
            </span>
          )}
        </div>

        {isSatisfied ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {who || satisfiedAt ? (
              <>
                Satisfied{who ? ` by ${who}` : ""}
                {satisfiedAt ? ` on ${formatDate(satisfiedAt)}` : ""}
              </>
            ) : (
              "Satisfied."
            )}
          </p>
        ) : (
          <div className="mt-0.5 space-y-2">
            <p
              className={
                condition.is_required
                  ? "text-[11px] font-semibold text-amber-600 dark:text-amber-400"
                  : "text-[11px] text-muted-foreground"
              }
            >
              {isTickable ? "Not yet certified — tap to certify." : "Not yet satisfied."}
            </p>

            {condition.kind === CONDITION_KINDS.FIELD && onSaveField && (
              <div className="flex items-center gap-2 max-w-[240px]">
                <input
                  type={DATE_FIELDS.has(condition.config?.column) ? "date" : "text"}
                  aria-label={condition.label}
                  value={fieldValue || ""}
                  disabled={isPreview}
                  onChange={(e) => onFieldChange?.(e.target.value)}
                  placeholder={`Enter ${condition.config?.column || "value"}`}
                  className="flex h-7 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={isPreview || savingField || !(fieldValue || "").trim()}
                  onClick={() => onSaveField?.()}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-7 px-3"
                >
                  {savingField ? "..." : "Save"}
                </button>
              </div>
            )}

            {condition.kind === CONDITION_KINDS.ATTACHMENT && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label
                  className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted ${
                    isPreview || uploading ? "pointer-events-none opacity-50" : ""
                  }`}
                >
                  <Paperclip size={13} />
                  {uploading ? "Uploading..." : "Attach File"}
                  <input
                    type="file"
                    className="hidden"
                    disabled={isPreview}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file || isPreview) return;
                      onUpload?.(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {onPickExisting && (
                  <button
                    type="button"
                    disabled={isPreview}
                    onClick={() => !isPreview && onPickExisting()}
                    className="flex h-8 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <FolderOpen size={13} /> Pick existing file
                  </button>
                )}
                <span className="text-[10px] text-muted-foreground">
                  Accepts: {acceptsLabel(condition.config?.accepts)}
                </span>
              </div>
            )}

            {condition.kind === CONDITION_KINDS.ASSIGNMENT && (
              <div className="flex items-center gap-2 mt-1.5 max-w-sm">
                <Dropdown
                  usePortal
                  className="flex-1 min-w-0"
                  trigger={({ isOpen }) => (
                    <FilterTrigger
                      label={
                        assignmentValue
                          ? employees.find((e) => e.id === assignmentValue)?.name || "Select..."
                          : `Assign ${condition.config?.department || "Member"}...`
                      }
                      isActive={!!assignmentValue}
                      isOpen={isOpen}
                      icon={UserPlus}
                      className="!h-8"
                    />
                  )}
                >
                  {({ close }) => (
                    <FilterOptionList
                      showSearch
                      options={employees.map((e) => ({
                        value: e.id,
                        label: e.name,
                      }))}
                      value={assignmentValue}
                      onChange={(val) => {
                        if (isPreview) return;
                        onAssignmentChange?.(val);
                        close();
                      }}
                      close={close}
                    />
                  )}
                </Dropdown>
                <button
                  type="button"
                  disabled={isPreview || !assignmentValue || assignPending}
                  onClick={() => onAssign?.()}
                  className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border/80 bg-background px-3 text-[12px] font-semibold text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {isSatisfied && who && <Avatar name={who} size="xs" className="mt-0.5 shrink-0" />}
    </div>
  );
}
