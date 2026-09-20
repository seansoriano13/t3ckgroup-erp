import { CheckCircle2, Circle, Paperclip, ListChecks, UserCheck, Square, CheckSquare, UserPlus, FolderOpen } from "lucide-react";
import Avatar from "../Avatar";
import { CONDITION_KINDS, CONDITION_STATUS } from "../../constants/stageGate";
import { formatDate } from "../../utils/formatDate";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList, FilterTrigger } from "../ui/FilterDropdown";
import { acceptsLabel } from "../../utils/attachments";
import { resolvePeople } from "../../utils/resolvePeople";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileInput } from "@/components/ui/FileInput";

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
  groups = [],
  opportunity = null,
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

  // Issue #203, story 17: a condition with a `who` narrows the dropdown to
  // only the people who'd actually satisfy it — a legacy `department`-only
  // condition (no `who` configured) keeps the full-list behaviour it always
  // had. `resolvePeople` (issue #201) is the one place selectors resolve to
  // employee ids, kept in sync with `groups` (fetched once by the parent)
  // instead of refetching Employee Groups per row.
  const whoSelectors = Array.isArray(condition.config?.who) ? condition.config.who : [];
  const groupMembersById = whoSelectors.length
    ? Object.fromEntries(groups.map((g) => [g.id, { employeeIds: g.memberIds || [], teams: [] }]))
    : undefined;
  const assignableEmployees =
    whoSelectors.length > 0
      ? (() => {
          const ids = new Set(resolvePeople(whoSelectors, { employees, groupMembersById, opportunity }));
          return employees.filter((e) => ids.has(e.id));
        })()
      : employees;

  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-border/50 bg-background px-3 py-2.5">
      <Button
        type="button"
        disabled={isPreview || !isTickable || tickDisabled}
        onClick={() => !isPreview && isTickable && onTick?.(condition)}
        aria-label={isTickable ? `Certify ${condition.label}` : undefined}
        variant="ghost" size="icon-xs" className={
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
      </Button>

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
                <Input
                  type={DATE_FIELDS.has(condition.config?.column) ? "date" : "text"}
                  aria-label={condition.label}
                  value={fieldValue || ""}
                  disabled={isPreview}
                  onChange={(e) => onFieldChange?.(e.target.value)}
                  placeholder={`Enter ${condition.config?.column || "value"}`}
                  className="h-7" containerClassName="w-full"
                />
                <Button
                  type="button"
                  disabled={isPreview || savingField || !(fieldValue || "").trim()}
                  onClick={() => onSaveField?.()}
                  variant="default" className="inline-flex whitespace-nowrap"
                >
                  {savingField ? "..." : "Save"}
                </Button>
              </div>
            )}

            {condition.kind === CONDITION_KINDS.ATTACHMENT && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <FileInput
                  disabled={isPreview || uploading}
                  onFiles={(files) => {
                    const file = files[0];
                    if (!file || isPreview) return;
                    onUpload?.(file);
                  }}
                >
                  <Paperclip size={13} />
                  {uploading ? "Uploading..." : "Attach File"}
                </FileInput>
                {onPickExisting && (
                  <Button
                    type="button"
                    disabled={isPreview}
                    onClick={() => !isPreview && onPickExisting()}
                    variant="outline"
                  >
                    <FolderOpen size={13} /> Pick existing file
                  </Button>
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
                          ? assignableEmployees.find((e) => e.id === assignmentValue)?.name || "Select..."
                          : whoSelectors.length > 0
                            ? "Assign..."
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
                      options={assignableEmployees.map((e) => ({
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
                <Button
                  type="button"
                  disabled={isPreview || !assignmentValue || assignPending}
                  onClick={() => onAssign?.()}
                  variant="outline" className="shrink-0"
                >
                  Assign
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {isSatisfied && who && <Avatar name={who} size="xs" className="mt-0.5 shrink-0" />}
    </div>
  );
}
