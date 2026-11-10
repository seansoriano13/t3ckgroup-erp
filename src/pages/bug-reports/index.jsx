import PageLoading from "@/components/ui/PageLoading";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePaging } from "@/hooks/usePaging";
import { TablePager } from "@/components/ui/TablePager";
import QueryError from "@/components/ui/QueryError";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug, CheckCircle2, RotateCcw, SendHorizontal } from "lucide-react";
import toast from "react-hot-toast";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import StatusBadge from "../../components/StatusBadge";
import SlideOver, { SlideOverBody, SlideOverFooter } from "../../components/ui/SlideOver";
import Avatar from "../../components/Avatar";
import { AttachmentList } from "../../components/ui/Attachments";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Textarea } from "../../components/ui/textarea";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../components/ui/table";
import { useTableSort } from "../../hooks/useTableSort";
import { useAuth } from "../../context/AuthContext";
import { useEmployeeAvatarMap } from "../../hooks/useEmployeeAvatarMap";
import { useRecordParam } from "../../hooks/useRecordParam";
import { bugReportService } from "../../services/bugReportService";
import { getPermissionContext } from "../../utils/permissions";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import { formatDateWith } from "../../utils/formatDate";
import { FieldBox } from "@/components/ui/FieldBox";

const REPORT_SORT = {
  report: (r) => r.description,
  "sent-by": (r) => r.reporter?.name,
  page: (r) => r.page_url,
  files: (r) => r.attachments?.length || 0,
  sent: (r) => new Date(r.created_at).getTime(),
  status: (r) => (r.resolved_at ? 1 : 0),
};

const HEAD = "text-label font-bold uppercase tracking-wider";

const firstLine = (text) => (text || "").split("\n")[0];
const formatWhen = (iso) =>
  formatDateWith(iso, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }, { time: true });

function Status({ report }) {
  return report.resolved_at ? (
    <StatusBadge theme="green" label="Resolved" />
  ) : (
    <StatusBadge theme="amber" label="Open" />
  );
}

function ReportRow({ report, onOpen, showSender }) {
  return (
    <TableRow
      tabIndex={0}
      onClick={() => onOpen(report.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(report.id);
        }
      }}
      className="cursor-pointer outline-none focus-visible:bg-muted"
    >
      <TableCell className="max-w-[28rem]">
        <span className="block truncate text-sm font-semibold text-foreground">{firstLine(report.description)}</span>
      </TableCell>
      {showSender && <TableCell className="hidden text-xs md:table-cell text-foreground">{report.reporter?.name || "—"}</TableCell>}
      <TableCell className="hidden max-w-[12rem] truncate md:table-cell font-mono text-xs text-muted-foreground">{report.page_url || "—"}</TableCell>
      <TableCell className="hidden text-xs tabular-nums md:table-cell text-muted-foreground">{report.attachments?.length || "—"}</TableCell>
      <TableCell className="hidden whitespace-nowrap text-xs md:table-cell text-muted-foreground">{formatWhen(report.created_at)}</TableCell>
      <TableCell className="text-right">
        <Status report={report} />
      </TableCell>
    </TableRow>
  );
}

function ReportFiles({ report }) {
  const { data: files = [], isLoading } = useQuery({
    queryKey: ["bugReportFiles", report.id, report.attachments?.length],
    queryFn: () => bugReportService.withUrls(report.attachments || []),
  });
  if (report.attachments_purged_at) {
    return <p className="text-xs text-muted-foreground">Files deleted after a year.</p>;
  }
  if (!report.attachments?.length) return null;
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading files…</p>;
  return <AttachmentList attachments={files.filter((f) => f.url)} />;
}

/** One stop on the rail: a node (avatar or icon) on the line, content beside it. */
function RailItem({ node, last, children }) {
  return (
    <li className="relative flex gap-3 pb-6 last:pb-0">
      {!last && <span aria-hidden="true" className="absolute top-7 bottom-1 left-[11.5px] w-px bg-mauve-7" />}
      <div className="relative z-10 shrink-0">{node}</div>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

function Byline({ name, tag, at }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 pt-0.5 text-[11px] text-muted-foreground">
      <span className="text-[13px] font-semibold text-foreground">{name}</span>
      {tag && <span>{tag}</span>}
      <time dateTime={at} className="whitespace-nowrap">
        <span aria-hidden="true">· </span>
        {formatWhen(at)}
      </time>
    </p>
  );
}

/** The technical facts sent with a report, small, under its text. */
function ReportMeta({ report }) {
  const facts = [
    ["Page", report.page_url, "font-mono break-all"],
    ["Environment", report.environment],
    ["Version", report.app_version],
    ["Browser", report.user_agent, "break-words"],
  ].filter(([, value]) => value);
  if (!facts.length) return null;
  return (
    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-muted/50 px-3 py-2 text-[11px]">
      {facts.map(([label, value, cls = ""]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className={`min-w-0 text-foreground ${cls}`} title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The report and its thread on one rail (CONTEXT.md -> Note): the report
 * itself first, then every note and every Resolved / Reopened, oldest first.
 * Not live; it loads when the report opens and after each send.
 */
function ReportRail({ report, meId, isReader, endRef }) {
  const avatars = useEmployeeAvatarMap();
  const { data: notes = [], isLoading, isError } = useQuery({
    queryKey: ["bugReportNotes", report.id],
    queryFn: () => bugReportService.listNotes(report.id),
  });
  const nameOf = (id, name) => (id === meId ? "You" : name || "Someone");
  const avatarOf = (id, name) => <Avatar name={name} src={avatars.get(id)} size="sm" className="rounded-full ring-4 ring-background" />;
  const isSenderNote = (n) => n.author_id === report.reporter_id;

  return (
    <ol>
      <RailItem node={avatarOf(report.reporter_id, report.reporter?.name)} last={notes.length === 0 && !isLoading && !isError}>
        <Byline name={nameOf(report.reporter_id, report.reporter?.name)} tag="reported this" at={report.created_at} />
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{report.description}</p>
        <div className="mt-3 empty:hidden">
          <ReportFiles report={report} />
        </div>
        {isReader && <ReportMeta report={report} />}
      </RailItem>

      {isLoading && (
        <RailItem node={<span className="block size-6" />} last>
          <p className="pt-1 text-xs text-muted-foreground">Loading notes…</p>
        </RailItem>
      )}
      {isError && (
        <RailItem node={<span className="block size-6" />} last>
          <p className="pt-1 text-xs text-red-11">Notes could not be loaded.</p>
        </RailItem>
      )}

      {notes.map((n, i) => {
        const last = i === notes.length - 1;
        if (n.kind !== "note") {
          const resolved = n.kind === "resolved";
          const Icon = resolved ? CheckCircle2 : RotateCcw;
          return (
            <RailItem
              key={n.id}
              last={last}
              node={
                <span
                  className={`grid size-6 place-items-center rounded-full border ring-4 ring-background ${
                    resolved ? "border-green-7 bg-green-3 text-green-11" : "border-border bg-card text-muted-foreground"
                  }`}
                >
                  <Icon size={13} strokeWidth={2.25} />
                </span>
              }
            >
              <p className="pt-1 text-[12px] text-muted-foreground">
                <span className="font-semibold text-foreground">{nameOf(n.author_id, n.author?.name)}</span>{" "}
                {resolved ? "marked this resolved" : "reopened this"}
                <span aria-hidden="true"> · </span>
                <time dateTime={n.created_at}>{formatWhen(n.created_at)}</time>
              </p>
            </RailItem>
          );
        }
        return (
          <RailItem key={n.id} last={last} node={avatarOf(n.author_id, n.author?.name)}>
            <Byline
              name={nameOf(n.author_id, n.author?.name)}
              tag={isReader && isSenderNote(n) && n.author_id !== meId ? "reporter" : null}
              at={n.created_at}
            />
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">{n.body}</p>
          </RailItem>
        );
      })}
      <li ref={endRef} aria-hidden="true" className="h-0" />
    </ol>
  );
}

/**
 * The pinned footer: write a note, and for a reader, tick Resolved / Reopen
 * beside it. Ctrl/Cmd+Enter sends.
 */
function ThreadComposer({ report, isReader, onSent }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const isResolved = !!report.resolved_at;

  const send = async () => {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      await bugReportService.addNote(report.id, draft);
      setDraft("");
      await queryClient.invalidateQueries({ queryKey: ["bugReportNotes", report.id] });
      onSent();
    } catch (err) {
      toast.error(err.message || "Could not send the note.");
    } finally {
      setSending(false);
    }
  };

  const toggleResolved = async () => {
    setSaving(true);
    try {
      await bugReportService.setResolved(report.id, !isResolved);
      await queryClient.invalidateQueries({ queryKey: ["bugReports"] });
      await queryClient.invalidateQueries({ queryKey: ["bugReportNotes", report.id] });
      onSent();
    } catch (err) {
      toast.error(err.message || "Could not update the report.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOverFooter>
      <Textarea
        rows={2}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={isReader ? "Write to the reporter, e.g. Fixed, can you check?" : "Reply to IT…"}
        aria-label="Note"
        disabled={sending}
        maxLength={4000}
        className="min-h-0 resize-none bg-card text-[13px] md:text-[13px]"
      />
      <div className="flex items-center gap-2">
        <span className="mr-auto hidden text-[11px] text-muted-foreground sm:inline">{/Mac|iPhone|iPad/i.test(navigator.platform || "") ? "⌘ Enter" : "Ctrl + Enter"} to send</span>
        {isReader && (
          <Button
            variant={isResolved ? "outline" : "default"}
            className={`max-sm:flex-1 ${isResolved ? "" : APPROVE_CLASS}`}
            disabled={saving}
            onClick={toggleResolved}
          >
            {isResolved ? <RotateCcw size={14} /> : <CheckCircle2 size={14} />}
            {isResolved ? "Reopen" : "Mark resolved"}
          </Button>
        )}
        <Button
          variant={isReader ? "outline" : "default"}
          className="max-sm:flex-1"
          onClick={send}
          disabled={sending || !draft.trim()}
        >
          <SendHorizontal size={14} />
          {sending ? "Sending…" : isReader ? "Send note" : "Send reply"}
        </Button>
      </div>
    </SlideOverFooter>
  );
}

function ReportSheet({ report, index, total, onStep, onClose, isReader, meId }) {
  const endRef = useRef(null);
  // After a send, bring the newest entry into view once the refetch lands.
  const scrollToEnd = () => requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }));

  return (
    <SlideOver
      record={report}
      icon={Bug}
      crumb={isReader ? "Bug Reports" : "My Bug Reports"}
      identity={(r) => ({
        ref: formatWhen(r.created_at),
        title: firstLine(r.description),
        badge: <Status report={r} />,
        subtitle: r.reporter?.name,
      })}
      index={index}
      total={total}
      onStep={onStep}
      onClose={onClose}
    >
      {(r) => (
        <>
          <SlideOverBody>
            <ReportRail report={r} meId={meId} isReader={isReader} endRef={endRef} />
          </SlideOverBody>
          <ThreadComposer key={r.id} report={r} isReader={isReader} onSent={scrollToEnd} />
        </>
      )}
    </SlideOver>
  );
}

/**
 * Bug Reports (CONTEXT.md): every report sent from the floating button, for
 * Super Admins and holders of the Bug Reports access right; anyone else sees
 * only the reports they sent ("My Bug Reports"), to follow the notes on them.
 * Opening the page as a reader also deletes the files of reports over a year
 * old.
 */
function BugReportsList({ isReader, meId }) {
  const { recordId, open, step, close } = useRecordParam();
  const [showResolved, setShowResolved] = useState(false);

  const queryClient = useQueryClient();
  const { data: reports = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["bugReports"],
    queryFn: () => bugReportService.list(),
  });

  // Once per page open, not on every refetch: delete the files of reports
  // over a year old, then reload the list if any went.
  const purgeRan = useRef(false);
  useEffect(() => {
    if (!isReader || purgeRan.current || isLoading || isError) return;
    purgeRan.current = true;
    bugReportService.purgeExpiredFiles(reports).then((purged) => {
      if (purged) queryClient.invalidateQueries({ queryKey: ["bugReports"] });
    });
  }, [isReader, isLoading, isError, reports, queryClient]);

  const unsorted = useMemo(
    () => (showResolved ? reports : reports.filter((r) => !r.resolved_at)),
    [reports, showResolved],
  );
  const { sorted: shown, sort, toggle } = useTableSort(unsorted, REPORT_SORT);
  const paging = usePaging(shown);
  // A deep link (notification) opens its report even when the filter hides it.
  const index = shown.findIndex((r) => String(r.id) === recordId);
  const openReport = index >= 0 ? shown[index] : reports.find((r) => String(r.id) === recordId) || null;

  return (
    <>
      <PageShell
        title={isReader ? "Bug Reports" : "My Bug Reports"}
        description={
          isReader
            ? "Everything employees reported with the bug button. Files are deleted a year after a report is sent."
            : "Bugs you reported with the bug button, and IT's notes on them."
        }
        toolbar={
          <FieldBox inline label="Show resolved" className="gap-2 text-xs font-medium normal-case tracking-normal text-muted-foreground">
            <Switch checked={showResolved} onCheckedChange={setShowResolved} />
            <span>Show resolved</span>
          </FieldBox>
        }
      >
        {isLoading && (
          <PageLoading label="bug reports" />
        )}

        {isError && (
          <QueryError title="Bug reports could not be loaded." onRetry={refetch} />
        )}

        {!isLoading && !isError && shown.length === 0 && (
          <EmptyState
            icon={Bug}
            title={showResolved ? "No bug reports yet" : "No open bug reports"}
            description="Reports sent with the bug button show up here."
            className="py-24"
          />
        )}

        {!isLoading && !isError && shown.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <Table tableId="bug-reports" className="md:min-w-[48rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {["Report", ...(isReader ? ["Sent by"] : []), "Page", "Files", "Sent", "Status"].map((heading) => (
                    <SortHead
                      key={heading}
                      id={heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                      sortKey={heading.toLowerCase().replace(/[^a-z0-9]+/g, "-")}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${heading === "Status" ? "text-right" : ""} ${heading !== "Report" && heading !== "Status" ? "hidden md:table-cell" : ""}`}
                    >
                      {heading}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((report) => (
                  <ReportRow key={report.id} report={report} onOpen={open} showSender={isReader} />
                ))}
              </TableBody>
            </Table>
            <TablePager {...paging} noun={shown.length === 1 ? "report" : "reports"} />
          </div>
        )}
      </PageShell>

      <ReportSheet
        report={openReport}
        index={Math.max(index, 0)}
        total={index >= 0 ? shown.length : 1}
        onStep={(delta) => {
          const next = shown[index + delta];
          if (next) step(next.id);
        }}
        onClose={close}
        isReader={isReader}
        meId={meId}
      />
    </>
  );
}

export default function BugReportsPage() {
  const { user } = useAuth();
  const { isSuperAdmin, hasBugReportAccess } = getPermissionContext(user);
  return <BugReportsList isReader={isSuperAdmin || hasBugReportAccess} meId={user?.id} />;
}
