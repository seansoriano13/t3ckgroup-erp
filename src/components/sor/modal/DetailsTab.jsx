import { cn } from "@/lib/utils";
import DatePicker from "react-datepicker";
import { ExternalLink, FileDown, Link2 } from "lucide-react";
import Spinner from "../../ui/Spinner";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import Dropdown from "../../ui/Dropdown";
import { FilterOptionList } from "../../ui/FilterDropdown";
import OpportunityCommissionFooter from "../OpportunityCommissionFooter";
import {
  PROJECT_TYPE_LABELS,
  formatLeadSource,
  itbGateSatisfiedBy,
  ITB_EXEMPT_LABEL,
} from "../../../constants/sor";
import { deriveProjectType } from "../../../utils/commission";
import { Button } from "../../ui/button";
import { useAuth } from "../../../context/AuthContext";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";

function Detail({ label, children, isEditing, control, wrapperClass = "w-full" }) {
  if (isEditing) {
    return (
      <div className={`bg-muted/30 border border-border rounded-xl p-3 flex flex-col group focus-within:border-mauve-7 focus-within:ring-1 ring-mauve-7 transition-all ${wrapperClass}`}>
        <FieldBox label={label} className="mb-1 block" />
        {control}
      </div>
    );
  }
  return (
    <div>
      <p className="text-label font-bold text-muted-foreground uppercase tracking-widest mb-1">{label}</p>
      <div className="text-sm font-semibold text-foreground break-words">
        {children || <span className="text-muted-foreground/60">—</span>}
      </div>
    </div>
  );
}

// Manila dates (ADR 0039) — one date picker in the Detail box shape.
function DateDetail({ label, field, isEditing, editForm, setEditForm, readValue }) {
  const value = editForm?.[field];
  return (
    <Detail
      label={label}
      isEditing={isEditing}
      control={
        <Dropdown
          usePortal
          placement="bottom-start"
          className="w-full"
          trigger={() => (
            <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
              <span className={value ? "text-foreground" : "text-muted-foreground/50"}>{value || "Select date..."}</span>
            </div>
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <DatePicker
                selected={value ? new Date(value) : null}
                onChange={(date) => {
                  if (!date) {
                    setEditForm((f) => ({ ...f, [field]: "" }));
                  } else {
                    const y = date.getFullYear();
                    const m = String(date.getMonth() + 1).padStart(2, "0");
                    const d = String(date.getDate()).padStart(2, "0");
                    setEditForm((f) => ({ ...f, [field]: `${y}-${m}-${d}` }));
                  }
                  close();
                }}
                inline
              />
            </div>
          )}
        </Dropdown>
      }
    >
      {readValue}
    </Detail>
  );
}

function peopleByRole(o) {
  const byId = new Map();
  const add = (person, role) => {
    if (!person) return;
    const entry = byId.get(person.id);
    if (entry) entry.roles.push(role);
    else byId.set(person.id, { person, roles: [role] });
  };
  add(o.deal_owner, o.project_type === "STRATEGIC" ? "Deal Owner / Originator" : "Deal Owner");
  add(o.closing_sales, "Closing Salesperson");
  add(o.sales_director, "Sales Director");
  add(o.support_1, "Support Sales 1");
  add(o.support_2, "Support Sales 2");
  return [...byId.values()];
}

function PeopleRoster({ opportunity }) {
  const people = peopleByRole(opportunity);
  const isStrategic = opportunity.project_type === "STRATEGIC";
  const missingParticipants = [];
  if (!opportunity.deal_owner) missingParticipants.push(isStrategic ? "Deal Owner / Originator" : "Deal Owner");
  if (isStrategic && !opportunity.closing_sales) missingParticipants.push("Closing Salesperson");
  if (!opportunity.sales_director) missingParticipants.push("Sales Director");

  return (
    <div className="space-y-3">
      {missingParticipants.length > 0 && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-2 text-xs text-amber-700 dark:text-amber-300">
          <p className="font-semibold">Unassigned: {missingParticipants.join(", ")}</p>
          <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-0.5">
            Unassigned roles leave their commission shares unattributed.
          </p>
        </div>
      )}
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground/60">No one assigned yet.</p>
      ) : (
        people.map(({ person, roles }) => (
          <div key={person.id} className="flex items-center gap-3">
            <Avatar name={person.name} src={person.avatar_path} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{person.name}</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {roles.map((role) => (
                  <span key={role} className="text-[10px] font-bold text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                    {role}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatLongDate(dateString) {
  if (!dateString) return "";
  return new Date(dateString).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Details (#302) — the SOR's own reference material, moved out of the old
 * flat layout's 4/8 grid and its footer: fields, the Deal Team, Estimated
 * Value with the quotation actions, and the commission footer. None of it
 * is what a Deal Owner opens an SOR to act on, which is why it no longer
 * crowds Now. The commission footer is rendered unchanged — #207 puts its
 * maths out of scope.
 *
 * Inclusions and Purchasing sit at the bottom here, rather than as
 * full-width panels above the grid, until #209 replaces them with the
 * Purchase Request card.
 *
 * Its one read of its own, the active Lead Sources, waits for this tab to
 * open (#298's lazy-fetch-once pattern) — see `activeLeadSources` in the
 * shell. The panels inside fetch their own data, only once rendered here.
 */
export default function DetailsTab({ ctx }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin === true || user?.isSuperAdmin === true;
  const {
    opportunity,
    isEditing,
    editForm,
    setEditForm,
    employees,
    activeLeadSources,
    estimatedValueDisplay,
    estimatedValueSize,
    buildingLink,
    handlePreviewQuotation,
    handleCopyQuotationLink,
    downloadStep,
    handleDownloadQuotation,
    onClose,
    accessLevel,
  } = ctx;

  // ADR 0021 / #297: Expected Value and commission stay Deal Team only, even
  // inside a Participant's window — so a Participant sees no Estimated Value
  // card, no Quotation Document actions (a priced document), and no
  // commission footer at all, not one with its figures hidden.
  const showMoney = accessLevel !== "participant";

  return (
    <div className="space-y-7 p-6">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-4">
          <div className="rounded-2xl border border-border/70 bg-card shadow-xs overflow-hidden divide-y divide-border/60">
            {showMoney && (
              <div className="p-5 bg-gradient-to-b from-muted/40 to-transparent">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-label font-bold tracking-widest text-muted-foreground uppercase">Estimated Value</span>
                  {opportunity.status && <StatusBadge status={opportunity.status} />}
                </div>
                {isEditing ? (
                  <div>
                    <p className={cn("font-black tracking-tight break-words text-foreground tabular-nums opacity-80", estimatedValueSize)}>
                      {estimatedValueDisplay}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-1 font-medium italic">Auto-calculated from Product List</p>
                  </div>
                ) : (
                  <p className={cn("font-black tracking-tight break-words text-foreground tabular-nums", estimatedValueSize)}>{estimatedValueDisplay}</p>
                )}
              </div>
            )}

            {showMoney && !isEditing && opportunity.sales_reference && (
              <div className="p-4 bg-muted/15 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground mb-1">
                  <span>Quotation Document</span>
                  <span className="font-mono text-primary">{opportunity.sales_reference}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={buildingLink}
                    onClick={handlePreviewQuotation}
                    className="flex-1 gap-1.5 text-[12px]"
                  >
                    {buildingLink ? <Spinner size="sm" /> : <ExternalLink size={13} />}
                    <span>Preview Quote</span>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={buildingLink}
                    onClick={handleCopyQuotationLink}
                    title="Copy customer quotation link"
                    aria-label="Copy customer quotation link"
                    className="text-muted-foreground"
                  >
                    <Link2 size={13} />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!downloadStep}
                  onClick={handleDownloadQuotation}
                  className="w-full gap-1.5 text-[12px]"
                >
                  {downloadStep ? <Spinner size="sm" /> : <FileDown size={13} />}
                  <span>Download Full PDF</span>
                </Button>
                {downloadStep && <p className="truncate text-center text-[10.5px] font-medium text-muted-foreground">{downloadStep}</p>}
              </div>
            )}

            <div className="p-5" id="sor-team-assignees">
              <p className="mb-3 text-label font-bold tracking-widest text-muted-foreground uppercase">Team & Assignees</p>
              {isEditing ? (
                <div className="space-y-3">
                  <Detail
                    label={editForm.project_type === "STRATEGIC" ? "Deal Owner / Originator" : "Deal Owner"}
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.deal_owner_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.deal_owner_id ? employees.find((e) => e.id === editForm.deal_owner_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.deal_owner_id}
                            onChange={(val) => setEditForm((f) => ({ ...f, deal_owner_id: val }))}
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                  {editForm.project_type === "STRATEGIC" && (
                    <Detail
                      label="Closing Salesperson"
                      isEditing={isEditing}
                      control={
                        <Dropdown
                          usePortal
                          className="w-full"
                          trigger={() => (
                            <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                              <span className={editForm.closing_sales_id ? "text-foreground" : "text-muted-foreground/50"}>
                                {editForm.closing_sales_id ? employees.find((e) => e.id === editForm.closing_sales_id)?.name : "Unassigned"}
                              </span>
                            </div>
                          )}
                        >
                          {({ close }) => (
                            <FilterOptionList
                              options={employees.map((e) => ({ value: e.id, label: e.name }))}
                              value={editForm.closing_sales_id}
                              onChange={(val) => setEditForm((f) => ({ ...f, closing_sales_id: val }))}
                              close={close}
                            />
                          )}
                        </Dropdown>
                      }
                    />
                  )}
                  <Detail
                    label="Sales Director"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.sales_director_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.sales_director_id ? employees.find((e) => e.id === editForm.sales_director_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.sales_director_id}
                            onChange={(val) => setEditForm((f) => ({ ...f, sales_director_id: val }))}
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                  <Detail
                    label="Support Sales 1"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.support_sales_1_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.support_sales_1_id ? employees.find((e) => e.id === editForm.support_sales_1_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.support_sales_1_id}
                            onChange={(val) =>
                              setEditForm((f) => {
                                const next = { ...f, support_sales_1_id: val };
                                next.project_type = deriveProjectType({
                                  supportSales1Id: next.support_sales_1_id,
                                  supportSales2Id: next.support_sales_2_id,
                                  currentProjectType: f.project_type,
                                });
                                return next;
                              })
                            }
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                  <Detail
                    label="Support Sales 2"
                    isEditing={isEditing}
                    control={
                      <Dropdown
                        usePortal
                        className="w-full"
                        trigger={() => (
                          <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer">
                            <span className={editForm.support_sales_2_id ? "text-foreground" : "text-muted-foreground/50"}>
                              {editForm.support_sales_2_id ? employees.find((e) => e.id === editForm.support_sales_2_id)?.name : "Unassigned"}
                            </span>
                          </div>
                        )}
                      >
                        {({ close }) => (
                          <FilterOptionList
                            options={employees.map((e) => ({ value: e.id, label: e.name }))}
                            value={editForm.support_sales_2_id}
                            onChange={(val) =>
                              setEditForm((f) => {
                                const next = { ...f, support_sales_2_id: val };
                                next.project_type = deriveProjectType({
                                  supportSales1Id: next.support_sales_1_id,
                                  supportSales2Id: next.support_sales_2_id,
                                  currentProjectType: f.project_type,
                                });
                                return next;
                              })
                            }
                            close={close}
                          />
                        )}
                      </Dropdown>
                    }
                  />
                </div>
              ) : (
                <PeopleRoster opportunity={opportunity} />
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-8">
          <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xs">
            <p className="mb-4 text-label font-bold tracking-widest text-muted-foreground uppercase">Deal Details</p>
            <div className={cn("grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3",)}>
              <Detail
                label="Lead Source"
                isEditing={isEditing}
                control={
                  <Dropdown
                    usePortal
                    className="w-full"
                    trigger={() => (
                      <div className="w-full h-full flex items-center justify-between bg-transparent text-sm font-medium outline-none cursor-pointer min-w-0">
                        <span className={`truncate ${editForm.lead_source ? "text-foreground" : "text-muted-foreground/50"}`}>
                          {editForm.lead_source ? activeLeadSources.find((l) => l.value === editForm.lead_source)?.label || editForm.lead_source : "Select..."}
                        </span>
                      </div>
                    )}
                  >
                    {({ close }) => (
                      <FilterOptionList
                        options={activeLeadSources.map((s) => ({ value: s.value, label: s.label }))}
                        value={editForm.lead_source}
                        onChange={(val) => setEditForm((f) => ({ ...f, lead_source: val }))}
                        close={close}
                      />
                    )}
                  </Dropdown>
                }
              >
                {formatLeadSource(opportunity.lead_source, opportunity.lead_source_detail, activeLeadSources)}
              </Detail>

              {editForm.lead_source === "OTHERS" && isEditing && (
                <Detail
                  label="Referral"
                  isEditing={isEditing}
                  control={
                    <Input
                      type="text"
                      value={editForm.lead_source_detail}
                      onChange={(e) => setEditForm((f) => ({ ...f, lead_source_detail: e.target.value }))}
                      containerClassName="w-full" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                      placeholder="Specify..."
                    />
                  }
                />
              )}

              <Detail
                label="Sales Division"
                isEditing={isEditing}
                control={
                  <div className="w-full flex items-center justify-between gap-2 min-w-0">
                    <span
                      data-testid="project-type-badge-edit"
                      className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-md border truncate ${
                        editForm.project_type === "STRATEGIC"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                          : editForm.project_type === "CP"
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"
                            : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                      }`}
                    >
                      {PROJECT_TYPE_LABELS[editForm.project_type] || editForm.project_type}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() =>
                        setEditForm((prev) => ({
                          ...prev,
                          project_type:
                            prev.project_type === "STRATEGIC"
                              ? deriveProjectType({ supportSales1Id: prev.support_sales_1_id, supportSales2Id: prev.support_sales_2_id })
                              : "STRATEGIC",
                        }))
                      }
                      className={`h-auto text-[11px] font-semibold px-2 py-0.5 rounded-md border shrink-0 ${
                        editForm.project_type === "STRATEGIC"
                          ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                          : "bg-muted/50 text-muted-foreground hover:text-foreground border-border hover:bg-muted"
                      }`}
                      title="Toggle Strategic project override"
                    >
                      {editForm.project_type === "STRATEGIC" ? "★ Strategic" : "Mark as Strategic"}
                    </Button>
                  </div>
                }
              >
                <span className="block truncate" title={PROJECT_TYPE_LABELS[opportunity.project_type]}>
                  {PROJECT_TYPE_LABELS[opportunity.project_type]}
                </span>
              </Detail>

              <Detail
                label="Date Registered"
                isEditing={isEditing}
                control={
                  <Dropdown
                    usePortal
                    placement="bottom-start"
                    className="w-full"
                    trigger={() => (
                      <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
                        <span className={editForm.registration_date ? "text-foreground" : "text-muted-foreground/50"}>
                          {editForm.registration_date || "Select date..."}
                        </span>
                      </div>
                    )}
                  >
                    {({ close }) => (
                      <div className="p-1">
                        <DatePicker
                          selected={editForm.registration_date ? new Date(editForm.registration_date) : null}
                          onChange={(date) => {
                            if (!date) {
                              setEditForm((f) => ({ ...f, registration_date: "" }));
                            } else {
                              const y = date.getFullYear();
                              const m = String(date.getMonth() + 1).padStart(2, "0");
                              const d = String(date.getDate()).padStart(2, "0");
                              setEditForm((f) => ({ ...f, registration_date: `${y}-${m}-${d}` }));
                            }
                            close();
                          }}
                          inline
                        />
                      </div>
                    )}
                  </Dropdown>
                }
              >
                {formatLongDate(opportunity.registration_date)}
              </Detail>

              <Detail
                label="Expected Award Date"
                isEditing={isEditing}
                control={
                  <Dropdown
                    usePortal
                    placement="bottom-start"
                    className="w-full"
                    trigger={() => (
                      <div className="w-full h-full flex items-center bg-transparent text-sm font-medium outline-none cursor-pointer">
                        <span className={editForm.expected_award_date ? "text-foreground" : "text-muted-foreground/50"}>
                          {editForm.expected_award_date || "Select date..."}
                        </span>
                      </div>
                    )}
                  >
                    {({ close }) => (
                      <div className="p-1">
                        <DatePicker
                          selected={editForm.expected_award_date ? new Date(editForm.expected_award_date) : null}
                          onChange={(date) => {
                            if (!date) {
                              setEditForm((f) => ({ ...f, expected_award_date: "" }));
                            } else {
                              const y = date.getFullYear();
                              const m = String(date.getMonth() + 1).padStart(2, "0");
                              const d = String(date.getDate()).padStart(2, "0");
                              setEditForm((f) => ({ ...f, expected_award_date: `${y}-${m}-${d}` }));
                            }
                            close();
                          }}
                          inline
                        />
                      </div>
                    )}
                  </Dropdown>
                }
              >
                {formatLongDate(opportunity.expected_award_date)}
              </Detail>

              {/* Once the Date of Award is set, only a Super Admin changes it (the
                  database enforces it too). PDI and Delivery stay open to the Deal Team. */}
              <DateDetail
                label="Date of Award"
                field="date_of_award"
                isEditing={isEditing && (!opportunity.date_of_award || isSuperAdmin)}
                editForm={editForm}
                setEditForm={setEditForm}
                readValue={formatLongDate(opportunity.date_of_award)}
              />
              <DateDetail
                label="Date of PDI"
                field="date_of_pdi"
                isEditing={isEditing}
                editForm={editForm}
                setEditForm={setEditForm}
                readValue={formatLongDate(opportunity.date_of_pdi)}
              />
              <DateDetail
                label="Date of Delivery"
                field="date_of_delivery"
                isEditing={isEditing}
                editForm={editForm}
                setEditForm={setEditForm}
                readValue={formatLongDate(opportunity.date_of_delivery)}
              />

              <Detail
                label="Contact Person"
                isEditing={isEditing}
                control={
                  <Input
                    type="text"
                    required
                    value={editForm.contact_person}
                    onChange={(e) => setEditForm((f) => ({ ...f, contact_person: e.target.value }))}
                    containerClassName="w-full" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                    placeholder="e.g. Juan Dela Cruz"
                  />
                }
              >
                {opportunity.contact_person}
              </Detail>

              <Detail label="Sales Reference">
                {opportunity.sales_reference ? (
                  <span className="font-mono text-primary font-bold">{opportunity.sales_reference}</span>
                ) : opportunity.status === "LEAD" ? (
                  <span className="text-xs font-medium text-amber-11">Required to qualify</span>
                ) : null}
              </Detail>

              {itbGateSatisfiedBy(opportunity) && (
                <Detail label="ITB Number (Invitation to Bid)">
                  {opportunity.itb_number || <span className="text-xs font-bold text-amber-11">{ITB_EXEMPT_LABEL}</span>}
                </Detail>
              )}
            </div>
          </div>
        </div>
      </div>


      {!isEditing && showMoney && <OpportunityCommissionFooter opportunity={opportunity} onClose={onClose} />}
    </div>
  );
}
