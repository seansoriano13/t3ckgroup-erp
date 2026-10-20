import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router";
import { Scale } from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import FilterBar from "../../../components/ui/FilterBar";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import { Button } from "../../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import CanvassPanel from "../../../components/CanvassPanel";
import { useAuth } from "../../../context/AuthContext";
import { canvassService } from "../../../services/canvassService";
import { CANVASS_KIND, CANVASS_LIST_KEY } from "../../../constants/canvass";
import { ANY, canvassSubjectLabel, filterCanvasses } from "../../../utils/canvassList";
import { getPermissionContext } from "../../../utils/permissions";

/**
 * The Canvasses page (ADR 0034, #566): every Canvass in one place, project ones on a Costing
 * Matrix Component included. A row opens that Canvass in the Canvass panel. The database limits
 * which rows a person gets; names only, no money.
 */

const SIGNED = [
  { value: ANY, label: "Any sign-off" },
  { value: "signed", label: "Signed off" },
  { value: "unsigned", label: "Not signed" },
];
const WINNER = [
  { value: ANY, label: "Winner or not" },
  { value: "yes", label: "Has a winner" },
  { value: "no", label: "No winner" },
];
const LINKED = [
  { value: ANY, label: "Linked or not" },
  { value: "linked", label: "On a Component or item" },
  { value: "free", label: "Not linked" },
];

const KIND_LABEL = {
  [CANVASS_KIND.COMPONENT]: "Component",
  [CANVASS_KIND.REQUESTED_ITEM]: "Requested Item",
  [CANVASS_KIND.NONE]: "No subject",
};

function CanvassesPage({ userId }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [canvasserId, setCanvasserId] = useState(ANY);
  const [signed, setSigned] = useState(ANY);
  const [winner, setWinner] = useState(ANY);
  const [linked, setLinked] = useState(ANY);

  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: CANVASS_LIST_KEY,
    queryFn: () => canvassService.list(),
  });

  const canvassers = useMemo(() => {
    const seen = new Map(rows.filter((r) => r.canvasserId).map((r) => [r.canvasserId, r.canvasserName ?? "Unknown"]));
    return [
      { value: ANY, label: "Any Canvasser" },
      ...[...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [rows]);

  const shown = filterCanvasses(rows, { search, canvasserId, signed, winner, linked });
  const active = Boolean(search) || canvasserId !== ANY || signed !== ANY || winner !== ANY || linked !== ANY;
  const clearAll = () => {
    setSearch("");
    setCanvasserId(ANY);
    setSigned(ANY);
    setWinner(ANY);
    setLinked(ANY);
  };

  // The open Canvass is in the address: ?canvass=<id>, or ?item= / ?component= for one found by its subject.
  const openRow = useMemo(() => {
    const id = params.get("canvass");
    const item = params.get("item");
    const component = params.get("component");
    return rows.find((r) => (id && r.id === id) || (item && r.requestedItemId === item) || (component && r.componentId === component)) ?? null;
  }, [params, rows]);
  const ready = !isLoading && !isError;

  return (
    <PageShell
      title="Canvasses"
      description="Every Canvass in one place, project ones included. Open one to see its Offers."
      toolbar={
        ready ? (
          <FilterBar
            search={{ value: search, onChange: setSearch, placeholder: "Search Canvasses" }}
            chips={
              <>
                <FilterSelect options={canvassers} value={canvasserId} onChange={setCanvasserId} label="Canvasser" className="h-9 w-auto" />
                <FilterSelect options={SIGNED} value={signed} onChange={setSigned} label="Signed state" className="h-9 w-auto" />
                <FilterSelect options={WINNER} value={winner} onChange={setWinner} label="Winner" className="h-9 w-auto" />
                <FilterSelect options={LINKED} value={linked} onChange={setLinked} label="Linked" className="h-9 w-auto" />
              </>
            }
            hasActiveFilters={active}
            onClearAll={clearAll}
          />
        ) : null
      }
    >
      {isLoading && <PageLoading label="Canvasses" />}
      {isError && <QueryError title="The Canvasses could not be loaded." onRetry={refetch} />}

      {ready && rows.length === 0 && (
        <EmptyState icon={Scale} title="No Canvasses yet" description="A Canvass starts when its first Offer is saved." />
      )}
      {ready && rows.length > 0 && shown.length === 0 && <EmptyState icon={Scale} title="No Canvass matches" description="Try clearing a filter." />}

      {ready && shown.length > 0 && (
        <div className="rounded-lg border">
          <Table tableId="canvasses" className="md:min-w-[44rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {["Number", "Subject", "Canvasser", "Winner", "Sign-off"].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow key={row.id} data-testid="canvass-row">
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 font-medium tabular-nums"
                      aria-label={`Open Canvass ${row.number}`}
                      onClick={() => setParams({ canvass: row.id })}
                    >
                      {row.number}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <span>{canvassSubjectLabel(row) || "—"}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">{KIND_LABEL[row.kind]}</span>
                  </TableCell>
                  <TableCell>{row.canvasserName ?? "—"}</TableCell>
                  <TableCell>
                    {row.winner ? [row.winner.supplierName, row.winner.brand].filter(Boolean).join(" · ") || "Picked" : "No winner"}
                    <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">
                      {row.offerCount} offer{row.offerCount === 1 ? "" : "s"}
                    </span>
                  </TableCell>
                  <TableCell>{row.signedOffAt ? `Signed off${row.signerName ? ` by ${row.signerName}` : ""}` : "Not signed"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {openRow && (
        <CanvassPanel
          open
          onOpenChange={(next) => !next && setParams({})}
          subject={{ canvassId: openRow.id }}
          subjectLabel={canvassSubjectLabel(openRow) || openRow.number}
          userId={userId}
          canEdit
          opportunityId={openRow.opportunityId ?? undefined}
        />
      )}
    </PageShell>
  );
}

/** Everyone with Purchasing access, and Super Admins; everyone else is sent home. */
export default function CanvassesRoute() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Canvasses" />;
  const ctx = getPermissionContext(user);
  if (!user || !(ctx.isSuperAdmin || ctx.hasPurchasingFlow)) return <Navigate to="/" replace />;
  return <CanvassesPage userId={user.id} />;
}
