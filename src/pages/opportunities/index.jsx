import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Search, Target } from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import Spinner from "../../components/ui/Spinner";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import OpportunityFormModal from "../../components/sor/OpportunityFormModal";
import OpportunityDetailsModal from "../../components/sor/OpportunityDetailsModal";
import { opportunityService } from "../../services/opportunityService";
import { useAuth } from "../../context/AuthContext";
import {
  OPPORTUNITY_STAGES,
  PROJECT_TYPE_SHORT,
  formatLeadSource,
  formatPHP,
} from "../../constants/sor";

const OPEN_STAGES = OPPORTUNITY_STAGES.filter(
  (s) => s.value !== "CLOSED_WON" && s.value !== "CLOSED_LOST",
).map((s) => s.value);

export default function OpportunitiesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("ALL");
  const [mineOnly, setMineOnly] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  const { data: opportunities = [], isLoading } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => opportunityService.getOpportunities(),
  });

  const createMutation = useMutation({
    mutationFn: (payload) =>
      opportunityService.createOpportunity(payload, user?.id),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      setFormOpen(false);
      toast.success(`Opportunity ${created.opportunity_no} registered.`);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (payload) =>
      opportunityService.updateOpportunity(editing.id, payload, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      setEditing(null);
      toast.success("Opportunity updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (stageFilter === "OPEN" && !OPEN_STAGES.includes(o.status)) return false;
      if (stageFilter !== "ALL" && stageFilter !== "OPEN" && o.status !== stageFilter)
        return false;
      if (mineOnly) {
        const mine =
          o.deal_owner_id === user?.id ||
          o.support_sales_1_id === user?.id ||
          o.support_sales_2_id === user?.id ||
          o.sales_director_id === user?.id;
        if (!mine) return false;
      }
      if (!q) return true;
      return [
        o.opportunity_no,
        o.client_name,
        o.project_title,
        o.deal_owner?.name,
        o.lead_source_detail,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [opportunities, search, stageFilter, mineOnly, user?.id]);

  const totals = useMemo(() => {
    const open = filtered.filter((o) => OPEN_STAGES.includes(o.status));
    return {
      count: filtered.length,
      openValue: open.reduce((sum, o) => sum + Number(o.expected_value || 0), 0),
    };
  }, [filtered]);

  const selected = opportunities.find((o) => o.id === selectedId) || null;

  return (
    <ProtectedRoute>
      <PageContainer className="pt-4">
        <PageHeader
          title="Opportunity Register"
          description="Register every lead before bid, proposal, or quotation issuance. Registration date establishes deal ownership."
        >
          <button
            onClick={() => setFormOpen(true)}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-[13px] shadow-lg shadow-primary/20 transition-all flex items-center gap-1.5 shrink-0"
          >
            <Plus size={15} /> Register Opportunity
          </button>
        </PageHeader>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2.5 mt-6">
          <div className="flex-1 bg-muted/30 border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 focus-within:border-mauve-7">
            <Search size={15} className="text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, client, project, deal owner…"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
            />
          </div>
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="bg-muted/30 border border-border rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground outline-none cursor-pointer focus:border-mauve-7"
          >
            <option value="ALL">All Stages</option>
            <option value="OPEN">Open Only</option>
            {OPPORTUNITY_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setMineOnly((v) => !v)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold border transition-all shrink-0 ${
              mineOnly
                ? "bg-primary/10 border-primary/40 text-primary"
                : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            My Deals
          </button>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground font-semibold">
          <span>{totals.count} opportunit{totals.count === 1 ? "y" : "ies"}</span>
          <span className="text-muted-foreground/40">•</span>
          <span>
            Open pipeline value{" "}
            <span className="text-foreground font-bold">
              {formatPHP(totals.openValue)}
            </span>
          </span>
        </div>

        {/* Table */}
        <div className="mt-4 border border-border rounded-2xl overflow-hidden bg-card">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Spinner size="sm" />
              <span className="text-sm font-bold uppercase tracking-widest">
                Loading register…
              </span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-3">
                <Target size={18} />
              </div>
              <p className="text-sm font-bold text-foreground">
                {opportunities.length === 0
                  ? "No opportunities registered yet"
                  : "No opportunities match these filters"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {opportunities.length === 0
                  ? "Register a lead to claim ownership of it."
                  : "Try clearing the search or stage filter."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="text-left font-bold px-4 py-3">No.</th>
                    <th className="text-left font-bold px-4 py-3">Date</th>
                    <th className="text-left font-bold px-4 py-3">Lead Source</th>
                    <th className="text-left font-bold px-4 py-3">Client</th>
                    <th className="text-left font-bold px-4 py-3">Project</th>
                    <th className="text-right font-bold px-4 py-3">Expected Value</th>
                    <th className="text-left font-bold px-4 py-3">Div.</th>
                    <th className="text-left font-bold px-4 py-3">Deal Owner</th>
                    <th className="text-left font-bold px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => setSelectedId(o.id)}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold text-primary whitespace-nowrap">
                        {o.opportunity_no}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {o.registration_date}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {formatLeadSource(o.lead_source, o.lead_source_detail)}
                      </td>
                      <td className="px-4 py-3 font-semibold">{o.client_name}</td>
                      <td className="px-4 py-3 max-w-[220px] truncate">
                        {o.project_title}
                      </td>
                      <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                        {formatPHP(o.expected_value)}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-muted-foreground">
                        {PROJECT_TYPE_SHORT[o.project_type] || o.project_type}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {o.deal_owner ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Avatar
                              name={o.deal_owner.name}
                              src={o.deal_owner.avatar_path}
                              size="xs"
                            />
                            <span className="text-xs font-semibold">
                              {o.deal_owner.name}
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </PageContainer>

      <OpportunityFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={(payload) => createMutation.mutate(payload)}
        isPending={createMutation.isPending}
      />

      <OpportunityFormModal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        onSubmit={(payload) => updateMutation.mutate(payload)}
        isPending={updateMutation.isPending}
        opportunity={editing}
      />

      <OpportunityDetailsModal
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        opportunity={selected}
        onEdit={(o) => {
          setSelectedId(null);
          setEditing(o);
        }}
      />
    </ProtectedRoute>
  );
}
