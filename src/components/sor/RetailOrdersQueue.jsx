import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ShoppingCart,
  CheckCircle,
  XCircle,
  Eye,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  User,
  DollarSign,
  Calendar,
  Building2,
  Package,
} from "lucide-react";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import {
  getRetailQueue,
  approveQueueItem,
  dismissQueueItem,
} from "../../services/retailQueueService";
import { formatPHP } from "../../constants/sor";
import { useAuth } from "../../context/AuthContext";
import { Button } from "@/components/ui/button";
import { TableRow, TableCell, Table, TableHeader, TableHead, TableBody } from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Approve / Edit Modal
// ---------------------------------------------------------------------------

function ApproveModal({ item, onConfirm, onClose, isPending }) {
  const [fields, setFields] = useState({
    client_name: item.client_name ?? item.odoo_partner_name ?? "",
    contact_person: item.contact_person ?? item.odoo_person_name ?? "",
    project_title: item.project_title ?? `Retail: ${item.odoo_partner_name}`,
    expected_value: item.expected_value ?? item.odoo_amount ?? 0,
  });

  const set = (key) => (e) => setFields((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-foreground">Approve Retail Order</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Review and confirm details before creating the SOR entry.
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400 text-xs font-bold border border-green-500/20">
              <ShoppingCart size={11} />
              {item.odoo_so_number}
            </span>
          </div>
        </div>

        {/* Form */}
        <div className="px-6 py-5 space-y-4">
          {/* Company / Client */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Company / Client
            </label>
            <input
              value={fields.client_name}
              onChange={set("client_name")}
              className="mt-1.5 w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-mauve-7 transition-colors"
              placeholder="Company or client name"
            />
          </div>
          {/* Contact Person */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Contact Person
            </label>
            <input
              value={fields.contact_person}
              onChange={set("contact_person")}
              className="mt-1.5 w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-mauve-7 transition-colors"
              placeholder="Buyer's name"
            />
          </div>
          {/* Project Title */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Project Title
            </label>
            <input
              value={fields.project_title}
              onChange={set("project_title")}
              className="mt-1.5 w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-mauve-7 transition-colors"
              placeholder="Project title"
            />
          </div>
          {/* Value */}
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Amount (₱)
            </label>
            <input
              type="number"
              value={fields.expected_value}
              onChange={set("expected_value")}
              className="mt-1.5 w-full bg-muted/30 border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-mauve-7 transition-colors"
              min={0}
            />
          </div>
          {/* Odoo data readonly summary */}
          <div className="rounded-xl bg-muted/20 border border-border p-3 space-y-1.5">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
              From Odoo
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 size={12} className="shrink-0" />
              <span className="text-foreground font-medium">{item.odoo_partner_name}</span>
            </div>
            {item.odoo_salesperson_name && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <User size={12} className="shrink-0" />
                <span>{item.odoo_salesperson_name}</span>
              </div>
            )}
            {item.odoo_date_order && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar size={12} className="shrink-0" />
                <span>{new Date(item.odoo_date_order).toLocaleDateString("en-PH")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-end gap-2.5">
          <Button
            onClick={onClose}
            disabled={isPending}
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(fields)}
            disabled={isPending}
            variant="ghost" className="h-auto"
          >
            {isPending ? (
              <Spinner size="xs" />
            ) : (
              <CheckCircle size={14} />
            )}
            Approve & Add to SOR
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Queue Row
// ---------------------------------------------------------------------------

function QueueRow({ item, onApprove, onDismiss, isApproving, isDismissing }) {
  const [approveOpen, setApproveOpen] = useState(false);

  const isDismissed = item.status === "dismissed";
  // Issue #173 — the approve button was never disabled, so a double click
  // fired two approvals for the same item. Both triggers below are guarded.
  const isBusy = isApproving || isDismissing;

  return (
    <>
      <TableRow className={`border-b border-border transition-colors ${isDismissed ? "opacity-50" : "hover:bg-muted/20"}`}>
        {/* SO Number */}
        <TableCell className="whitespace-nowrap">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/50 border border-border text-xs font-mono font-bold text-foreground">
            <Package size={10} className="text-muted-foreground" />
            {item.odoo_so_number}
          </span>
        </TableCell>
        {/* Company / Contact */}
        <TableCell >
          <p className="text-sm font-semibold text-foreground">{item.client_name || item.odoo_partner_name}</p>
          {item.contact_person && (
            <p className="text-xs text-muted-foreground mt-0.5">{item.contact_person}</p>
          )}
        </TableCell>
        {/* Value */}
        <TableCell className="text-right whitespace-nowrap">
          <span className="text-sm font-bold text-foreground">
            {formatPHP(item.expected_value ?? item.odoo_amount ?? 0)}
          </span>
        </TableCell>
        {/* Salesperson */}
        <TableCell >
          {item.deal_owner ? (
            <div className="flex items-center gap-2">
              <Avatar name={item.deal_owner.name} size="xs" />
              <span className="text-xs font-medium text-foreground">{item.deal_owner.name}</span>
            </div>
          ) : item.odoo_salesperson_name ? (
            <span className="text-xs text-muted-foreground">{item.odoo_salesperson_name}</span>
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
        </TableCell>
        {/* Date */}
        <TableCell className="whitespace-nowrap">
          <span className="text-xs text-muted-foreground">
            {item.odoo_date_order
              ? new Date(item.odoo_date_order).toLocaleDateString("en-PH", {
                  year: "numeric", month: "short", day: "numeric",
                })
              : "—"}
          </span>
        </TableCell>
        {/* Status / Actions */}
        <TableCell className="whitespace-nowrap">
          {isDismissed ? (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-muted/50 border border-border text-xs font-bold text-muted-foreground">
              <XCircle size={10} />
              Dismissed
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              <Button
                onClick={() => setApproveOpen(true)}
                disabled={isBusy}
                variant="ghost" className="h-auto"
              >
                <CheckCircle size={11} />
                Approve
              </Button>
              <Button
                onClick={() => onDismiss(item.id)}
                disabled={isBusy}
                variant="outline"
              >
                <XCircle size={11} />
                Dismiss
              </Button>
            </div>
          )}
        </TableCell>
      </TableRow>

      {approveOpen && (
        <ApproveModal
          item={item}
          isPending={isApproving}
          onClose={() => setApproveOpen(false)}
          onConfirm={(edits) => {
            onApprove(item.id, edits);
            setApproveOpen(false);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function RetailOrdersQueue() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showDismissed, setShowDismissed] = useState(false);

  const { data: pending = [], isLoading: loadingPending } = useQuery({
    queryKey: ["retailQueue", "pending"],
    queryFn: () => getRetailQueue({ status: "pending" }),
  });

  const { data: dismissed = [], isLoading: loadingDismissed } = useQuery({
    queryKey: ["retailQueue", "dismissed"],
    queryFn: () => getRetailQueue({ status: "dismissed" }),
    enabled: showDismissed,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, edits }) => approveQueueItem(id, edits),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retailQueue"] });
      queryClient.invalidateQueries({ queryKey: ["retailQueueCount"] });
      toast.success("Order approved and added to SOR.");
    },
    onError: (err) => toast.error(err.message || "Failed to approve."),
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => dismissQueueItem(id, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["retailQueue"] });
      queryClient.invalidateQueries({ queryKey: ["retailQueueCount"] });
      toast.success("Order dismissed.");
    },
    onError: (err) => toast.error(err.message || "Failed to dismiss."),
  });

  const isLoading = loadingPending;

  return (
    <div className="mt-4">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
            <ShoppingCart size={15} className="text-muted-foreground" />
            Retail Orders Queue
            {pending.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                {pending.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Marketplace orders from Odoo waiting for review. Approve to create a SOR entry.
          </p>
        </div>
        <Button
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ["retailQueue"] });
          }}
          variant="outline"
        >
          <RefreshCw size={12} />
          Refresh
        </Button>
      </div>

      {/* Pending table */}
      <div className="border border-border rounded-2xl overflow-hidden bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
            <Spinner size="sm" />
            <span className="text-sm font-bold uppercase tracking-widest">Loading queue…</span>
          </div>
        ) : pending.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <CheckCircle size={32} className="text-green-500/50" />
            <p className="text-sm font-semibold">No pending retail orders</p>
            <p className="text-xs text-muted-foreground/70">
              The hourly sync will add new marketplace orders here when they arrive.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table >
              <TableHeader>
                <TableRow >
                  <TableHead className="whitespace-nowrap">SO #</TableHead>
                  <TableHead >Client / Buyer</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                  <TableHead className="whitespace-nowrap">Assigned To</TableHead>
                  <TableHead className="whitespace-nowrap">Order Date</TableHead>
                  <TableHead >Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onApprove={(id, edits) => approveMutation.mutate({ id, edits })}
                    onDismiss={(id) => dismissMutation.mutate(id)}
                    isApproving={approveMutation.isPending && approveMutation.variables?.id === item.id}
                    isDismissing={dismissMutation.isPending && dismissMutation.variables === item.id}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Dismissed section (collapsible) */}
      <div className="mt-4">
        <Button
          onClick={() => setShowDismissed((v) => !v)}
          variant="ghost" className="h-auto"
        >
          {showDismissed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Dismissed Orders
          {dismissed.length > 0 && showDismissed && (
            <span className="text-muted-foreground/60">({dismissed.length})</span>
          )}
        </Button>

        {showDismissed && (
          <div className="mt-3 border border-border rounded-2xl overflow-hidden bg-card">
            {loadingDismissed ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <Spinner size="sm" />
              </div>
            ) : dismissed.length === 0 ? (
              <div className="py-10 text-center text-xs text-muted-foreground/60">
                No dismissed orders.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table >
                  <TableHeader>
                    <TableRow >
                      <TableHead >SO #</TableHead>
                      <TableHead >Client / Buyer</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead >Assigned To</TableHead>
                      <TableHead >Order Date</TableHead>
                      <TableHead >Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dismissed.map((item) => (
                      <QueueRow
                        key={item.id}
                        item={item}
                        onApprove={() => {}}
                        onDismiss={() => {}}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
