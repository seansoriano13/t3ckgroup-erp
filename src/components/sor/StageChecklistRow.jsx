import { FileInput } from "@/components/ui/FileInput";
import { PackageCheck, ShoppingCart, Calculator, ClipboardCheck, FileCheck, Tags, CheckCircle2, Circle, Paperclip, ListChecks, UserCheck, Square, CheckSquare, UserPlus, FolderOpen } from "lucide-react";
import Avatar from "../Avatar";
import { CONDITION_KINDS, CONDITION_STATUS } from "../../constants/stageGate";
import { formatDate } from "../../utils/formatDate";
import Dropdown from "../ui/Dropdown";
import { FilterOptionList, FilterTrigger } from "../ui/FilterDropdown";
import { acceptsLabel } from "../../utils/attachments";
import { resolvePeople } from "../../utils/resolvePeople";
import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";
import SalesReferenceStageField, { SALES_REFERENCE_COLUMN } from "./SalesReferenceStageField";

/** PO Date and Expected Award Date are dates; every other writable field is text. */
const DATE_FIELDS = new Set(["po_date", "expected_award_date"]);

const KIND_LABELS = {
  [CONDITION_KINDS.ATTACHMENT]: "Attachment",
  [CONDITION_KINDS.FIELD]: "Field on record",
  [CONDITION_KINDS.TICKBOX]: "Self-certified",
  [CONDITION_KINDS.ASSIGNMENT]: "Assignment",
  [CONDITION_KINDS.PURCHASING]: "Purchasing",
  [CONDITION_KINDS.PURCHASING_SETTLED]: "Purchasing settled",
  [CONDITION_KINDS.COSTING_SETTLED]: "Costing settled",
  [CONDITION_KINDS.COSTING_PRICED]: "Costing priced",
  [CONDITION_KINDS.COSTING_EVALUATION_APPROVED]: "Evaluation of Specification approved",
  [CONDITION_KINDS.GOODS_CHECKED]: "Goods checked",
  [CONDITION_KINDS.ORDERS_FILED]: "Orders filed",
};

const KIND_ICONS = {
  [CONDITION_KINDS.ATTACHMENT]: Paperclip,
  [CONDITION_KINDS.FIELD]: ListChecks,
  [CONDITION_KINDS.TICKBOX]: CheckSquare,
  [CONDITION_KINDS.ASSIGNMENT]: UserCheck,
  [CONDITION_KINDS.PURCHASING]: ShoppingCart,
  [CONDITION_KINDS.PURCHASING_SETTLED]: PackageCheck,
  [CONDITION_KINDS.COSTING_SETTLED]: Calculator,
  [CONDITION_KINDS.COSTING_PRICED]: Tags,
  [CONDITION_KINDS.COSTING_EVALUATION_APPROVED]: ClipboardCheck,
  [CONDITION_KINDS.GOODS_CHECKED]: ClipboardCheck,
  [CONDITION_KINDS.ORDERS_FILED]: FileCheck,
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
  // Why a condition is unmet, where the kind can say (Costing settled, #272):
  // { failing: [keys], messages: [plain sentences] }. Goods checked and Orders
  // filed add `basis` ([{ number, state }]), the records they read, met or not.
  detail = null,
  employees = [],
  groups = [],
  opportunity = null,
  isPreview = false,
  // Field on record
  fieldValue = "",
  onFieldChange,
  onSaveField,
  savingField = false,
  onFieldSaved,
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
        variant="ghost"
        disabled={isPreview || !isTickable || tickDisabled}
        onClick={() => !isPreview && isTickable && onTick?.(condition)}
        aria-label={isTickable ? `Certify ${condition.label}` : undefined}
        className={
          isSatisfied
            ? "h-auto w-auto mt-0.5 shrink-0 p-0 text-green-9 hover:bg-transparent hover:text-green-9"
            : isTickable
              ? "h-auto w-auto mt-0.5 shrink-0 p-0 text-muted-foreground hover:bg-transparent hover:text-foreground disabled:opacity-50"
              : "h-auto w-auto mt-0.5 shrink-0 p-0 text-muted-foreground/40 hover:bg-transparent hover:text-muted-foreground/40"
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
          <>
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
            <ConditionBasis label={condition.label} basis={detail?.basis} />
          </>
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

            {detail?.messages?.length > 0 && (
              <ul aria-label={`${condition.label}: what is missing`} className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                {detail.messages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}

            <ConditionBasis label={condition.label} basis={detail?.basis} />

            {condition.kind === CONDITION_KINDS.FIELD &&
              condition.config?.column === SALES_REFERENCE_COLUMN &&
              opportunity?.id &&
              !isPreview && (
                <SalesReferenceStageField
                  opportunityId={opportunity.id}
                  value={opportunity.sales_reference || ""}
                  onSaved={onFieldSaved}
                />
              )}

            {condition.kind === CONDITION_KINDS.FIELD && onSaveField &&
              !(condition.config?.column === SALES_REFERENCE_COLUMN && opportunity?.id && !isPreview) && (
              <div className="flex items-center gap-2 max-w-[240px]">
                <Input
                  type={DATE_FIELDS.has(condition.config?.column) ? "date" : "text"}
                  aria-label={condition.label}
                  value={fieldValue || ""}
                  disabled={isPreview}
                  onChange={(e) => onFieldChange?.(e.target.value)}
                  placeholder={`Enter ${condition.config?.column || "value"}`}
                  containerClassName="flex w-full" className="h-7 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={isPreview || savingField || !(fieldValue || "").trim()}
                  onClick={() => onSaveField?.()}
                  className="text-[11px]"
                >
                  {savingField ? "..." : "Save"}
                </Button>
              </div>
            )}

            {condition.kind === CONDITION_KINDS.ATTACHMENT && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <FileInput
                  disabled={isPreview || uploading}
                  onFiles={([file]) => onUpload?.(file)}
                  className="text-[12px] font-semibold">
                  <Paperclip size={13} />
                  {uploading ? "Uploading..." : "Attach File"}
                </FileInput>
                {onPickExisting && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPreview}
                    onClick={() => !isPreview && onPickExisting()}
                    className="gap-1.5 text-[12px]"
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
                  variant="outline"
                  disabled={isPreview || !assignmentValue || assignPending}
                  onClick={() => onAssign?.()}
                  className="shrink-0 text-[12px]"
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

/** The records a condition read (Goods checked's Transmittals, Orders filed's IPAS), by number and state. */
function ConditionBasis({ label, basis }) {
  if (!basis?.length) return null;
  return (
    <ul aria-label={`${label}: based on`} className="mt-1 flex flex-wrap gap-1">
      {basis.map((record) => (
        <li key={record.number} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          <span className="font-semibold text-foreground">{record.number}</span> · {record.state}
        </li>
      ))}
    </ul>
  );
}
