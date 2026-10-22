import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router";
import { Plus, Scale } from "lucide-react";

import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import PageLoading from "../../../components/ui/PageLoading";
import QueryError from "../../../components/ui/QueryError";
import FilterBar from "../../../components/ui/FilterBar";
import { FilterSelect } from "../../../components/ui/FilterDropdown";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import CanvassPanel from "../../../components/CanvassPanel";
import NewCanvassModal from "../../../components/NewCanvassModal";
import CreatePurchaseRequestModal from "../../../components/CreatePurchaseRequestModal";
import CanvassRequestBadge from "../../../components/CanvassRequestBadge";
import { useAuth } from "../../../context/AuthContext";
import { canvassService } from "../../../services/canvassService";
import { CANVASS_KIND, CANVASS_LIST_KEY } from "../../../constants/canvass";
import { ANY, LINKED_FILTER, REQUEST_FILTER, SIGNED_FILTER, WINNER_FILTER, canvassSubjectLabel, canvassAddressParams, filterCanvasses } from "../../../utils/canvassList";
import { getPermissionContext } from "../../../utils/permissions";

/**
 * The Canvasses page (ADR 0034, #566): every Canvass in one place, project ones on a Costing
 * Matrix Component included. A row opens that Canvass in the Canvass panel. The database limits
 * which rows a person gets; names only, no money.
 */

const SIGNED = [
  { value: ANY, label: "Any sign-off" },
  { value: SIGNED_FILTER.SIGNED, label: "Signed off" },
  { value: SIGNED_FILTER.UNSIGNED, label: "Not signed" },
];
const WINNER = [
  { value: ANY, label: "Winner or not" },
  { value: WINNER_FILTER.YES, label: "Has a winner" },
  { value: WINNER_FILTER.NO, label: "No winner" },
];
const LINKED = [
  { value: ANY, label: "Linked or not" },
  { value: LINKED_FILTER.LINKED, label: "On a Component or item" },
  { value: LINKED_FILTER.FREE, label: "Not linked" },
];

const REQUEST = [
  { value: ANY, label: "Any request" },
  { value: REQUEST_FILTER.NOT_YET, label: "Not requested yet" },
  { value: REQUEST_FILTER.CREATED, label: "Request created" },
];

const KIND_LABEL = {
  [CANVASS_KIND.COMPONENT]: "Component",
  [CANVASS_KIND.REQUESTED_ITEM]: "Requested Item",
  [CANVASS_KIND.NONE]: "No subject",
};

function CanvassesPage({ userId, canEdit }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [canvasserId, setCanvasserId] = useState(ANY);
  const [signed, setSigned] = useState(ANY);
  const [winner, setWinner] = useState(ANY);
  const [linked, setLinked] = useState(ANY);
  const [request, setRequest] = useState(ANY);

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

  const shown = filterCanvasses(rows, { search, canvasserId, signed, winner, linked, request });
  const active = Boolean(search) || canvasserId !== ANY || signed !== ANY || winner !== ANY || linked !== ANY || request !== ANY;
  const clearAll = () => {
    setSearch("");
    setCanvasserId(ANY);
    setSigned(ANY);
    setWinner(ANY);
    setLinked(ANY);
    setRequest(ANY);
  };

  // The open Canvass is in the address: ?canvass=<id>, or ?item= / ?component= for one found by its subject.
  const { canvass: canvassParam, item: itemParam, component: componentParam } = canvassAddressParams(params);
  // An exact ?canvass= match wins over a Canvass found by its subject.
  const openRow = useMemo(
    () =>
      (canvassParam && rows.find((r) => r.id === canvassParam)) ||
      rows.find((r) => (itemParam && r.requestedItemId === itemParam) || (componentParam && r.componentId === componentParam)) ||
      null,
    [canvassParam, itemParam, componentParam, rows],
  );
  // ?item= / ?component= with no Canvass yet opens a draft; nothing is created until its first Offer is saved.
  const draftSubject = useMemo(() => {
    if (openRow) return null;
    if (componentParam) return { componentId: componentParam };
    if (itemParam) return { requestedItemId: itemParam };
    return null;
  }, [openRow, itemParam, componentParam]);
  const ready = !isLoading && !isError;
  const openCanvass = (id) => setParams({ canvass: id });
  // New Canvasses with no subject: nothing is written until Save (canvass_start), which makes the
  // starter their Canvasser and gives each a number. Then each is a row like any other.
  const [starting, setStarting] = useState(false);

  // Picking Canvasses for one Purchase Request (ADR 0034): only subject-less ones can be picked.
  const [picked, setPicked] = useState([]);
  const [creating, setCreating] = useState(false);
  const pickedRows = rows.filter((r) => picked.includes(r.id));
  const togglePick = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <PageShell
      title="Canvasses"
      description="Every Canvass in one place, project ones included. Open one to see its Offers."
      action={
        canEdit ? (
        <div className="flex gap-2">
          {picked.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
              Create Purchase Request ({picked.length})
            </Button>
          )}
          <Button type="button" size="sm" onClick={() => setStarting(true)}>
            <Plus className="size-4" aria-hidden="true" />
            New Canvass
          </Button>
        </div>
        ) : null
      }
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
                <FilterSelect options={REQUEST} value={request} onChange={setRequest} label="Request" className="h-9 w-auto" />
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
        <EmptyState icon={Scale} title="No Canvasses yet" description="A Canvass starts when its first Offer is saved. Use New Canvass to research a product before anyone files a request." />
      )}
      {ready && rows.length > 0 && shown.length === 0 && <EmptyState icon={Scale} title="No Canvass matches" description="Try clearing a filter." />}

      {ready && shown.length > 0 && (
        <div className="rounded-lg border">
          <Table tableId="canvasses" className="md:min-w-[44rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                {["", "Number", "Subject", "Canvasser", "Winner", "Sign-off", "Request"].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((row) => (
                <TableRow
                  key={row.id}
                  data-testid="canvass-row"
                  tabIndex={0}
                  className="cursor-pointer outline-none focus-visible:bg-muted"
                  onClick={() => openCanvass(row.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && e.target === e.currentTarget) {
                      e.preventDefault();
                      openCanvass(row.id);
                    }
                  }}
                >
                  <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                    {canEdit && row.kind === CANVASS_KIND.NONE && (
                      <Checkbox
                        aria-label={`Pick Canvass ${row.number}`}
                        checked={picked.includes(row.id)}
                        onCheckedChange={() => togglePick(row.id)}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      className="h-auto p-0 font-medium tabular-nums"
                      aria-label={`Open Canvass ${row.number}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openCanvass(row.id);
                      }}
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
                  <TableCell>
                    <CanvassRequestBadge source={row} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating && canEdit && (
        <CreatePurchaseRequestModal
          open
          onOpenChange={setCreating}
          canvasses={pickedRows}
          onCreated={() => {
            setCreating(false);
            setPicked([]);
          }}
        />
      )}

      {starting && canEdit && <NewCanvassModal open onOpenChange={setStarting} userId={userId} />}

      {openRow && (
        <CanvassPanel
          open
          onOpenChange={(next) => !next && setParams({})}
          subject={{ canvassId: openRow.id }}
          subjectLabel={canvassSubjectLabel(openRow) || openRow.number}
          userId={userId}
          canEdit={canEdit}
          opportunityId={openRow.opportunityId ?? undefined}
        />
      )}
      {ready && draftSubject && (
        <CanvassPanel
          open
          onOpenChange={(next) => !next && setParams({})}
          subject={draftSubject}
          subjectLabel="New Canvass"
          userId={userId}
          canEdit={canEdit}
        />
      )}
    </PageShell>
  );
}

/** Any signed-in employee may open a Canvass behind a Requested Item; only Purchasing and Super Admins edit. */
export default function CanvassesRoute() {
  const { user, isAuthLoading } = useAuth();
  if (isAuthLoading) return <PageLoading label="Canvasses" />;
  const ctx = getPermissionContext(user);
  if (!user) return <Navigate to="/" replace />;
  return <CanvassesPage userId={user.id} canEdit={Boolean(ctx.isSuperAdmin || ctx.hasPurchasingFlow)} />;
}
