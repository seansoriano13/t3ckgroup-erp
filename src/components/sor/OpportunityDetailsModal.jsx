import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { X, Target, Send, Pencil, Trash2, Sparkles } from "lucide-react";
import ModalOverlay from "../ui/ModalOverlay";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import { opportunityService } from "../../services/opportunityService";
import { useAuth } from "../../context/AuthContext";
import { confirmDeleteToast } from "../ui/CustomToast";
import {
  OPPORTUNITY_STAGES,
  PROJECT_TYPE_LABELS,
  formatLeadSource,
  formatPHP,
} from "../../constants/sor";

function Detail({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
        {label}
      </p>
      <p className="text-sm font-semibold text-foreground break-words">
        {children || <span className="text-muted-foreground/60">—</span>}
      </p>
    </div>
  );
}

function Person({ person }) {
  if (!person) return <span className="text-muted-foreground/60">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={person.name} src={person.avatar_path} size="xs" />
      {person.name}
    </span>
  );
}

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function OpportunityDetailsModal({
  isOpen,
  onClose,
  opportunity,
  onEdit,
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [pendingStage, setPendingStage] = useState("");
  const [lostReason, setLostReason] = useState("");

  const id = opportunity?.id;

  const { data: notes = [], isLoading: loadingNotes } = useQuery({
    queryKey: ["opportunityNotes", id],
    queryFn: () => opportunityService.getNotes(id),
    enabled: !!id && isOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["opportunityNotes", id] });
  };

  const addNoteMutation = useMutation({
    mutationFn: (content) => opportunityService.addNote(id, user?.id, content),
    onSuccess: () => {
      setNote("");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const stageMutation = useMutation({
    mutationFn: ({ next, reason }) =>
      opportunityService.updateStatus(id, next, user?.id, reason),
    onSuccess: () => {
      setPendingStage("");
      setLostReason("");
      invalidate();
      toast.success("Stage updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => opportunityService.deleteOpportunity(id, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast.success("Opportunity deleted.");
      onClose();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!opportunity) return null;

  const isLostPending = pendingStage === "CLOSED_LOST";

  const handleStageChange = (next) => {
    if (!next || next === opportunity.status) return;
    if (next === "CLOSED_LOST") {
      setPendingStage(next);
      return;
    }
    stageMutation.mutate({ next, reason: null });
  };

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose}>
      <div className="bg-popover border border-border w-[720px] max-w-[95vw] max-h-[90vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-border/60 shrink-0 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary/10 text-primary shrink-0">
                <Target size={11} strokeWidth={2.5} />
              </div>
              <span className="font-mono text-xs font-bold text-primary">
                {opportunity.opportunity_no}
              </span>
              <StatusBadge status={opportunity.status} />
            </div>
            <h2 className="text-lg font-black text-foreground truncate">
              {opportunity.project_title}
            </h2>
            <p className="text-xs text-muted-foreground font-medium truncate">
              {opportunity.client_name}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => onEdit(opportunity)}
              title="Edit"
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() =>
                confirmDeleteToast(
                  `Delete ${opportunity.opportunity_no}?`,
                  "The record is archived, not erased.",
                  () => deleteMutation.mutate(),
                )
              }
              title="Delete"
              className="p-1.5 rounded-md text-muted-foreground hover:text-red-500 hover:bg-muted/80 transition-colors"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Detail label="Lead Source">
              {formatLeadSource(
                opportunity.lead_source,
                opportunity.lead_source_detail,
              )}
            </Detail>
            <Detail label="Sales Division">
              {PROJECT_TYPE_LABELS[opportunity.project_type]}
            </Detail>
            <Detail label="Expected Value">
              {formatPHP(opportunity.expected_value)}
            </Detail>
            <Detail label="Registered">{opportunity.registration_date}</Detail>
            <Detail label="Expected Award">
              {opportunity.expected_award_date}
            </Detail>
            <Detail label="Contact Person">{opportunity.contact_person}</Detail>
            <Detail label="Deal Owner">
              <Person person={opportunity.deal_owner} />
            </Detail>
            <Detail label="Sales Director">
              <Person person={opportunity.sales_director} />
            </Detail>
            <Detail label="Support Sales">
              {opportunity.support_1 || opportunity.support_2 ? (
                <span className="flex flex-col gap-1">
                  {opportunity.support_1 && (
                    <Person person={opportunity.support_1} />
                  )}
                  {opportunity.support_2 && (
                    <Person person={opportunity.support_2} />
                  )}
                </span>
              ) : null}
            </Detail>
          </div>

          {opportunity.lost_reason && (
            <div className="bg-red-500/5 border border-red-400/40 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-1">
                Lost Reason
              </p>
              <p className="text-sm text-foreground">{opportunity.lost_reason}</p>
            </div>
          )}

          {/* Stage control */}
          <div className="border-t border-border/50 pt-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
              Pipeline Stage
            </p>
            <div className="flex items-center gap-2">
              <select
                value={opportunity.status}
                disabled={stageMutation.isPending}
                onChange={(e) => handleStageChange(e.target.value)}
                className="bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm font-semibold text-foreground outline-none cursor-pointer focus:border-mauve-7 disabled:opacity-50"
              >
                {OPPORTUNITY_STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {stageMutation.isPending && <Spinner size="sm" />}
            </div>

            {isLostPending && (
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1 bg-muted/30 border border-border rounded-xl p-3 focus-within:border-mauve-7">
                  <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1 block">
                    Reason for loss
                  </label>
                  <input
                    autoFocus
                    value={lostReason}
                    onChange={(e) => setLostReason(e.target.value)}
                    placeholder="e.g. Lost to lower bid"
                    className="w-full bg-transparent text-sm text-foreground outline-none font-medium"
                  />
                </div>
                <button
                  disabled={!lostReason.trim() || stageMutation.isPending}
                  onClick={() =>
                    stageMutation.mutate({
                      next: "CLOSED_LOST",
                      reason: lostReason.trim(),
                    })
                  }
                  className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-[13px] transition-all disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={() => {
                    setPendingStage("");
                    setLostReason("");
                  }}
                  className="h-10 px-3 rounded-xl text-muted-foreground hover:text-foreground font-bold text-[13px]"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="border-t border-border/50 pt-4">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-3">
              Log Notes
            </p>

            {loadingNotes ? (
              <Spinner size="sm" />
            ) : notes.length === 0 ? (
              <p className="text-xs text-muted-foreground/70 italic">
                No notes yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {notes.map((n) => (
                  <li key={n.id} className="flex gap-2.5">
                    {n.type === "SYSTEM" ? (
                      <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                        <Sparkles size={12} />
                      </div>
                    ) : (
                      <Avatar
                        name={n.author?.name}
                        src={n.author?.avatar_path}
                        size="sm"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-muted-foreground font-semibold">
                        {n.type === "SYSTEM" ? "System" : n.author?.name || "Unknown"}
                        <span className="font-normal text-muted-foreground/60">
                          {" · "}
                          {formatWhen(n.created_at)}
                        </span>
                      </p>
                      <p
                        className={`text-sm break-words ${
                          n.type === "SYSTEM"
                            ? "text-muted-foreground italic"
                            : "text-foreground"
                        }`}
                      >
                        {n.content}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form
              className="mt-4 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (note.trim()) addNoteMutation.mutate(note);
              }}
            >
              <div className="flex-1 bg-muted/30 border border-border rounded-xl p-3 focus-within:border-mauve-7">
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note — client meeting, bid status, follow-up…"
                  className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={!note.trim() || addNoteMutation.isPending}
                className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-[13px] transition-all disabled:opacity-50 flex items-center gap-1.5"
              >
                {addNoteMutation.isPending ? (
                  <Spinner size="sm" />
                ) : (
                  <Send size={13} />
                )}
                Post
              </button>
            </form>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
