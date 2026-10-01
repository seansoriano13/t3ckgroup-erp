import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bug } from "lucide-react";
import toast from "react-hot-toast";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import Spinner from "../../components/ui/Spinner";
import StatusBadge from "../../components/StatusBadge";
import SlideOver, { SlideOverBody, SlideOverFooter } from "../../components/ui/SlideOver";
import { DetailRow, DetailSection } from "../../components/ui/DetailParts";
import { AttachmentList } from "../../components/ui/Attachments";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { useAuth } from "../../context/AuthContext";
import { useRecordParam } from "../../hooks/useRecordParam";
import { bugReportService } from "../../services/bugReportService";
import { getPermissionContext } from "../../utils/permissions";
import { APPROVE_CLASS } from "../approvals/_components/approvalUi";

const HEAD = "text-[10px] font-bold uppercase tracking-wider";

const firstLine = (text) => (text || "").split("\n")[0];
const formatWhen = (iso) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

function Status({ report }) {
  return report.resolved_at ? (
    <StatusBadge theme="green" label="Resolved" />
  ) : (
    <StatusBadge theme="amber" label="Open" />
  );
}

function ReportRow({ report, onOpen }) {
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
      <TableCell className="text-xs text-foreground">{report.reporter?.name || "—"}</TableCell>
      <TableCell className="max-w-[12rem] truncate font-mono text-xs text-muted-foreground">{report.page_url || "—"}</TableCell>
      <TableCell className="text-xs tabular-nums text-muted-foreground">{report.attachments?.length || ""}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatWhen(report.created_at)}</TableCell>
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
  if (!report.attachments?.length) return <p className="text-xs text-muted-foreground">None</p>;
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  return <AttachmentList attachments={files.filter((f) => f.url)} />;
}

function ReportSheet({ report, index, total, onStep, onClose }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const toggleResolved = async (r) => {
    setSaving(true);
    try {
      await bugReportService.setResolved(r.id, !r.resolved_at);
      await queryClient.invalidateQueries({ queryKey: ["bugReports"] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOver
      record={report}
      icon={Bug}
      crumb="Bug Reports"
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
            <DetailSection title="What went wrong">
              <p className="whitespace-pre-wrap break-words text-[13px] text-foreground">{r.description}</p>
            </DetailSection>
            <DetailSection title="Attachments">
              <ReportFiles report={r} />
            </DetailSection>
            <DetailSection title="Details">
              <dl className="divide-y divide-border">
                <DetailRow label="Sent by">{r.reporter?.name}</DetailRow>
                <DetailRow label="Sent">{formatWhen(r.created_at)}</DetailRow>
                <DetailRow label="Page"><span className="break-all font-mono text-xs">{r.page_url}</span></DetailRow>
                <DetailRow label="Environment">{r.environment}</DetailRow>
                <DetailRow label="App version">{r.app_version}</DetailRow>
                <DetailRow label="Browser"><span className="break-words text-xs">{r.user_agent}</span></DetailRow>
                {r.resolved_at && <DetailRow label="Resolved">{formatWhen(r.resolved_at)}</DetailRow>}
              </dl>
            </DetailSection>
          </SlideOverBody>
          <SlideOverFooter>
            <Button
              variant={r.resolved_at ? "outline" : "default"}
              className={r.resolved_at ? "w-full" : `w-full ${APPROVE_CLASS}`}
              disabled={saving}
              onClick={() => toggleResolved(r)}
            >
              {r.resolved_at ? "Reopen" : "Mark resolved"}
            </Button>
          </SlideOverFooter>
        </>
      )}
    </SlideOver>
  );
}

/**
 * Bug Reports (CONTEXT.md): every report sent from the floating button, for
 * Super Admins and holders of the Bug Reports access right. Opening the page
 * also deletes the files of reports over a year old.
 */
function BugReportsList() {
  const { recordId, open, step, close } = useRecordParam();
  const [showResolved, setShowResolved] = useState(false);

  const queryClient = useQueryClient();
  const { data: reports = [], isLoading, isError, error } = useQuery({
    queryKey: ["bugReports"],
    queryFn: () => bugReportService.list(),
  });

  // Once per page open, not on every refetch: delete the files of reports
  // over a year old, then reload the list if any went.
  const purgeRan = useRef(false);
  useEffect(() => {
    if (purgeRan.current || isLoading || isError) return;
    purgeRan.current = true;
    bugReportService.purgeExpiredFiles(reports).then((purged) => {
      if (purged) queryClient.invalidateQueries({ queryKey: ["bugReports"] });
    });
  }, [isLoading, isError, reports, queryClient]);

  const shown = useMemo(
    () => (showResolved ? reports : reports.filter((r) => !r.resolved_at)),
    [reports, showResolved],
  );
  // A deep link (notification) opens its report even when the filter hides it.
  const index = shown.findIndex((r) => String(r.id) === recordId);
  const openReport = index >= 0 ? shown[index] : reports.find((r) => String(r.id) === recordId) || null;

  return (
    <>
      <PageShell
        title="Bug Reports"
        description="Everything employees reported with the bug button. Files are deleted a year after a report is sent."
        toolbar={
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Switch checked={showResolved} onCheckedChange={setShowResolved} aria-label="Show resolved" />
            <span aria-hidden="true">Show resolved</span>
          </div>
        }
      >
        {isLoading && (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        )}

        {isError && (
          <div className="rounded-xl border border-red-6 bg-red-a2 px-5 py-8 text-center">
            <p className="text-sm font-semibold text-red-11">Bug reports could not be loaded.</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message}</p>
          </div>
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
            <Table className="min-w-[48rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {["Report", "Sent by", "Page", "Files", "Sent", "Status"].map((heading) => (
                    <TableHead key={heading} className={`${HEAD} ${heading === "Status" ? "text-right" : ""}`}>
                      {heading}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((report) => (
                  <ReportRow key={report.id} report={report} onOpen={open} />
                ))}
              </TableBody>
            </Table>
            <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              {shown.length} {shown.length === 1 ? "report" : "reports"}
            </div>
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
      />
    </>
  );
}

export default function BugReportsPage() {
  const { user } = useAuth();
  const { isSuperAdmin, hasBugReportAccess } = getPermissionContext(user);

  if (!isSuperAdmin && !hasBugReportAccess) {
    return (
      <PageShell title="Bug Reports">
        <EmptyState
          icon={Bug}
          title="You don't have access to Bug Reports"
          description="This screen needs the Bug Reports access right. Ask a Super Admin or HR to turn it on for you."
          className="py-24"
        />
      </PageShell>
    );
  }
  return <BugReportsList />;
}
