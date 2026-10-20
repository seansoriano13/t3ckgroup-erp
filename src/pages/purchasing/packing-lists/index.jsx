import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import toast from "react-hot-toast";
import { PackageOpen, Plus } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import TabGroup from "../../../components/ui/TabGroup";
import { Button } from "../../../components/ui/button";
import ModalShell from "../../../components/ui/ModalShell";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Input } from "../../../components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import SorPicker from "../../../components/ipas/SorPicker";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { packingListService } from "../../../services/packingListService";
import { ipasErrorMessage } from "../../../utils/ipas";

/**
 * The Packing Lists list (#255, spec #251): every Packing List the signed-in
 * employee may read, newest first, with draft and packed tabs. A new list is
 * made for one SOR, optionally with its Odoo delivery reference.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const TAB = { DRAFT: "draft", PACKED: "packed", ALL: "all" };
const KEY = ["packing-lists"];

function NewPackingListDialog({ open, onOpenChange }) {
  const navigate = useNavigate();
  const [sor, setSor] = useState([]);
  const [deliveryRef, setDeliveryRef] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setSor([]);
    setDeliveryRef("");
  };

  const create = async () => {
    if (sor.length !== 1) return;
    setSaving(true);
    try {
      const made = await packingListService.create({ opportunityId: sor[0].id, odooDeliveryRef: deliveryRef || null });
      toast.success(`${made.number} started`);
      onOpenChange(false);
      reset();
      navigate(`/purchasing/packing-lists/${made.id}`);
    } catch (error) {
      toast.error(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      crumbs={["Packing List", "New Packing List"]}
      actions={
        <Button size="lg" onClick={create} disabled={saving || sor.length !== 1}>
          {saving ? "Making…" : "Make Packing List"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">A Packing List is for one SOR. Its boxes are added on the next page.</p>
        <div className="space-y-4">
          <FieldBox label="SOR" bare>
            <SorPicker selected={sor} onChange={(next) => setSor(next.slice(-1))} />
          </FieldBox>
          <FieldBox label="Odoo delivery reference (optional)" bare>
            <Input value={deliveryRef} onChange={(e) => setDeliveryRef(e.target.value)} placeholder="e.g. TG En/OUT/03390" />
          </FieldBox>
        </div>
    </ModalShell>
  );
}

function PackingListsList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin, isTransmittalWarehouse } = getPermissionContext(user);
  const canMake = hasPurchasingFlow || isSuperAdmin || isTransmittalWarehouse;

  const [tab, setTab] = useState(TAB.DRAFT);
  const [creating, setCreating] = useState(false);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: KEY,
    queryFn: () => packingListService.list(),
  });

  const visible = rows.filter((row) => tab === TAB.ALL || row.state === tab);
  const count = (t) => rows.filter((row) => t === TAB.ALL || row.state === t).length;

  return (
    <PageShell
      title="Packing Lists"
      description="What the Warehouse packs in each box for an SOR. Signing Packed by closes a list."
      action={
        canMake && (
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus size={14} />
            New Packing List
          </Button>
        )
      }
      toolbar={
        <TabGroup
          variant="pill"
          size="sm"
          activeTab={tab}
          onChange={setTab}
          tabs={[
            { value: TAB.DRAFT, label: "Draft", badge: count(TAB.DRAFT) },
            { value: TAB.PACKED, label: "Packed", badge: count(TAB.PACKED) },
            { value: TAB.ALL, label: "All", badge: rows.length },
          ]}
        />
      }
    >
      {isLoading && <PageLoading label="Packing Lists" />}
      {isError && <QueryError title="Packing Lists could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={PackageOpen}
          title={rows.length === 0 ? "No Packing Lists yet" : "No matching Packing Lists"}
          description={
            rows.length === 0
              ? "A Packing List records the boxes packed for an SOR, with their marks, seals and contents."
              : "Nothing in this tab. Try another tab."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="packing-lists" className="md:min-w-[40rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className={HEAD}>Number</TableHead>
                  <TableHead className={HEAD}>SOR</TableHead>
                  <TableHead className={HEAD}>Boxes</TableHead>
                  <TableHead className={HEAD}>Odoo ref</TableHead>
                  <TableHead className={HEAD}>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.id} className="cursor-pointer" onClick={() => navigate(`/purchasing/packing-lists/${row.id}`)}>
                    <TableCell className="font-mono font-semibold">{row.number}</TableCell>
                    <TableCell>
                      <span className="font-mono">{row.sorReference ?? "—"}</span>
                      {row.projectTitle && <span className="text-muted-foreground"> · {row.projectTitle}</span>}
                    </TableCell>
                    <TableCell>{row.boxCount}</TableCell>
                    <TableCell>{row.odooDeliveryRef ?? "—"}</TableCell>
                    <TableCell>{row.state === "packed" ? "Packed" : "Draft"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <NewPackingListDialog open={creating} onOpenChange={setCreating} />
    </PageShell>
  );
}

export default function PackingListsPage() {
  return (
    <ProtectedRoute>
      <PackingListsList />
    </ProtectedRoute>
  );
}
