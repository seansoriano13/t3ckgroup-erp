/**
 * REMOVE-BEFORE-PROD (ADR 0028) — Product status prototype. Build-gated: the
 * route page loads this folder through a dynamic import() behind a static
 * VITE_APP_ENV check, so a production bundle has none of it. Delete the
 * folder by 2026-12-31 (CI fails staging after that) or bump the date on
 * purpose.
 *
 * A clickable preview of one product-status list for a project Purchase
 * Request, built from the app's real components and example data. It reads
 * and writes nothing: every change lives in this component's state.
 */
import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { Plus, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router";

import PropertyPills from "@/components/record/PropertyPills";
import RecordHeader from "@/components/record/RecordHeader";
import { Button } from "@/components/ui/button";
import { STATUS_THEME } from "@/constants/statusTheme";
import { AskDialog, AttachP0Dialog, ReplaceDialog, YoursDialog } from "./Dialogs";
import { DirectRequestsView, NewDirectDialog, SorDirectView } from "./DirectViews";
import LineSection from "./LineSection";
import PrototypeBar from "./PrototypeBar";
import ReadySummary from "./ReadySummary";
import {
  FIRST_NEW_CANVASS_NUMBER,
  FIRST_NEW_REQUEST_NUMBER,
  INITIAL_DIRECT_REQUESTS,
  INITIAL_LINES,
  PROJECT,
  VIEWS,
} from "./data";
import {
  ROLE,
  STATUS,
  addAsked,
  attachP0,
  checkStock,
  keepSeparate,
  mergeRequest,
  replaceLine,
  setByHand,
  startCanvass,
  summarize,
} from "./lineState";

const code = (prefix, n) => `${prefix}_${String(n).padStart(4, "0")}`;

export default function ProductStatusPrototype() {
  const [params, setParams] = useSearchParams();
  const view = VIEWS.find((v) => v.key === params.get("view"))?.key ?? "project";
  const role = params.get("as") === "sales" ? ROLE.SALES : ROLE.PURCHASING;
  const by = role === ROLE.SALES ? "Sales" : "Purchasing";

  const [lines, setLines] = useState(INITIAL_LINES);
  const [direct, setDirect] = useState(INITIAL_DIRECT_REQUESTS);
  const [stockAt, setStockAt] = useState("2 hours ago");
  const [dialog, setDialog] = useState(null); // { kind, id }
  const [newDirectOpen, setNewDirectOpen] = useState(view === "direct");
  const [open, setOpen] = useState({ sor: true, other: true });
  const [requestNo, setRequestNo] = useState(FIRST_NEW_REQUEST_NUMBER);
  const counters = useRef({ canvass: FIRST_NEW_CANVASS_NUMBER, line: 1 });
  const sorRef = useRef(null);
  const otherRef = useRef(null);

  const setQuery = (key, value, fallback) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  const changeView = (key) => {
    setQuery("view", key, "project");
    if (key === "direct") setNewDirectOpen(true);
  };
  const changeRole = (key) => setQuery("as", key, ROLE.PURCHASING);

  const lineOf = (id) => lines.find((l) => l.id === id);
  const closeDialog = () => setDialog(null);

  const choose = (id, status) => {
    setLines((prev) => setByHand(prev, id, status));
    toast.success(`${lineOf(id).name}: ${status}.`);
  };

  const act = (kind, line) => {
    if (kind === "canvass") {
      const canvassCode = code("CNV", counters.current.canvass);
      counters.current.canvass += 1;
      setLines((prev) => startCanvass(prev, line.id, canvassCode));
      toast.success(`${line.name}: Still canvassing. Canvass ${canvassCode} started.`);
    } else {
      setDialog({ kind, id: line.id });
    }
  };

  const attach = (p0) => {
    const line = lineOf(dialog.id);
    const next = attachP0(lines, line.id, p0);
    setLines(next);
    toast.success(`${p0.number} attached. ${line.name} is now ${next.find((l) => l.id === line.id).status}.`);
    closeDialog();
  };

  const replace = ({ newName, newCode, p0, reason }) => {
    const old = lineOf(dialog.id);
    counters.current.line += 1;
    setLines((prev) => replaceLine(prev, old.id, { newName, newCode, p0, reason, newId: `n${counters.current.line}`, by }));
    toast.success(`${old.name} replaced by ${newName}.`);
    closeDialog();
  };

  const ask = ({ text, qty, forWhat, photos }) => {
    counters.current.line += 1;
    setLines((prev) => addAsked(prev, { id: `n${counters.current.line}`, text, qty, forWhat, photos, by }));
    setOpen((prev) => ({ ...prev, other: true }));
    toast.success("Request added under Other requests as Not checked.");
    closeDialog();
  };

  const recheckStock = () => {
    const result = checkStock(lines);
    setLines(result.lines);
    setStockAt("just now");
    toast.success(result.changed ? `Stock checked. ${result.changed} Available line is no longer covered.` : "Stock checked. Nothing changed.");
  };

  const sendDirect = ({ title, project }) => {
    const pr = code("PR", requestNo);
    setRequestNo((n) => n + 1);
    setDirect((prev) => [...prev, { id: pr, title, pr, p0: null, status: STATUS.NOT_CHECKED, project }]);
    toast.success(`Sent to Purchasing as ${pr}.`);
    setNewDirectOpen(false);
  };

  const jump = (key) => {
    setOpen((prev) => ({ ...prev, [key]: true }));
    ({ sor: sorRef, other: otherRef })[key].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const sorLines = lines.filter((l) => l.section === "sor");
  const otherLines = lines.filter((l) => l.section === "other");
  const summary = summarize(lines);
  const target = dialog && lineOf(dialog.id);
  const nextRequest = code("PR", requestNo);

  return (
    <div className="space-y-4">
      <PrototypeBar view={view} onView={changeView} role={role} onRole={changeRole} />
      {role === ROLE.SALES && (
        <p className="text-xs text-muted-foreground">Viewing as Sales. Canvass, Attach P0 and Replace are hidden, because only Purchasing sees them.</p>
      )}

      {view === "project" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 space-y-3">
              <RecordHeader
                reference={PROJECT.sor}
                name={PROJECT.client}
                badge={{ label: "Example data", theme: STATUS_THEME.AMBER }}
                line="Purchase Request · Project"
              />
              <PropertyPills
                items={[
                  { key: "s0", label: "S0", value: PROJECT.s0 },
                  { key: "request", label: "Request", value: PROJECT.request },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Stock checked {stockAt}</span>
              <Button type="button" variant="outline" size="sm" onClick={recheckStock}>
                <RefreshCw size={14} aria-hidden="true" />
                Check stock now
              </Button>
              <Button type="button" size="sm" onClick={() => setDialog({ kind: "ask" })}>
                <Plus size={14} aria-hidden="true" />
                Ask for a product
              </Button>
            </div>
          </div>

          <ReadySummary
            summary={summary}
            jumps={[
              { key: "sor", label: "From the S0", count: sorLines.length, onClick: () => jump("sor") },
              { key: "other", label: "Other requests", count: otherLines.length, onClick: () => jump("other") },
            ]}
          />

          <LineSection
            id="sor"
            title="From the S0"
            subtitle={`${PROJECT.s0} · ${sorLines.length} products`}
            lines={sorLines}
            open={open.sor}
            onOpenChange={(v) => setOpen((prev) => ({ ...prev, sor: v }))}
            role={role}
            onChoose={choose}
            onAction={act}
            onYours={(line) => setDialog({ kind: "yours", id: line.id })}
            sectionRef={sorRef}
          />
          <LineSection
            id="other"
            title="Other requests"
            subtitle="Asked for in words"
            lines={otherLines}
            open={open.other}
            onOpenChange={(v) => setOpen((prev) => ({ ...prev, other: v }))}
            role={role}
            onChoose={choose}
            onAction={act}
            onYours={(line) => setDialog({ kind: "yours", id: line.id })}
            sectionRef={otherRef}
          />
        </div>
      )}

      {view === "direct" && <DirectRequestsView requests={direct} onNew={() => setNewDirectOpen(true)} />}
      {view === "sor" && <SorDirectView requests={direct} />}

      {dialog?.kind === "ask" && <AskDialog open onOpenChange={(v) => !v && closeDialog()} onSave={ask} />}
      {dialog?.kind === "attach" && <AttachP0Dialog open onOpenChange={(v) => !v && closeDialog()} line={target} onAttach={attach} />}
      {dialog?.kind === "replace" && <ReplaceDialog open onOpenChange={(v) => !v && closeDialog()} line={target} onReplace={replace} />}
      {dialog?.kind === "yours" && (
        <YoursDialog
          open
          onOpenChange={(v) => !v && closeDialog()}
          sorLine={target}
          request={lineOf(target.matchesRequest)}
          onYes={() => {
            setLines((prev) => mergeRequest(prev, target.id));
            toast.success(`${lineOf(target.matchesRequest).p0.number} and its delivery are now on the S0 line. The request is closed.`);
            closeDialog();
          }}
          onNo={() => {
            setLines((prev) => keepSeparate(prev, target.id));
            toast.success("Kept as two separate products.");
            closeDialog();
          }}
        />
      )}
      {newDirectOpen && <NewDirectDialog open onOpenChange={setNewDirectOpen} number={nextRequest} onSend={sendDirect} />}
    </div>
  );
}
