import PageLoading from "@/components/ui/PageLoading";
import { useEffect, useMemo, useRef, useState } from "react";
import QueryError from "@/components/ui/QueryError";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Star, Users } from "lucide-react";
import toast from "react-hot-toast";
import { groupTaskService } from "../../../services/groupTaskService";
import { useAuth } from "../../../context/AuthContext";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import HighlightText from "../../../components/HighlightText";
import { formatDate } from "../../../utils/formatDate.js";
import { relativeAge, shortRef } from "../../../utils/approvalItems.js";
import { isStaleSince, resolveApprovalShortcut } from "../../../utils/approvalQueue.js";
import { ApprovalChain, DetailRow, DetailSection, NotePresets, PersonChip } from "@/components/ui/DetailParts";
import { SlideOverBody, SlideOverFooter } from "@/components/ui/SlideOver";
import { ApprovalTable } from "./ApprovalTable";
import { ApprovalSheet } from "./ApprovalSheet";
import { APPROVE_CLASS, NOTE_PRESETS } from "./approvalUi";

const QUEUE = { label: "Group Tasks", icon: Users };

/** A group task as an ApprovalItem in the HR queue: Created → Head grading → HR verification. */
function groupTaskToItem(task, now = Date.now()) {
  const clockAt = task.updated_at || task.created_at;
  const members = task.members || [];
  return {
    id: task.id,
    queue: "hr",
    ref: shortRef("GRP", task.id),
    title: task.title,
    typeLabel: `Group task · ${members.length} member${members.length === 1 ? "" : "s"}`,
    person: {
      id: task.created_by,
      name: task.creator?.name || "Unknown",
      avatarPath: task.creator?.avatar_path || null,
      dept: task.creator?.sub_department || task.creator?.department || "",
    },
    submittedAt: task.created_at,
    clockAt,
    isStale: isStaleSince(clockAt, now),
    done: false,
    isHighPriority: false,
    attachmentCount: 0,
    chain: [
      { label: "Created", who: task.creator?.name || "Head", state: "done", at: task.created_at },
      { label: "Head grading", who: task.creator?.name || "Head", state: "done", at: null },
      { label: "HR verification", who: "HR", state: "current", at: null },
    ],
    source: task,
  };
}

function MemberEvaluation({ member, searchTerm }) {
  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[13px] font-semibold text-foreground">
          <HighlightText text={member.employee?.name || "Unknown"} search={searchTerm} />
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs font-bold tabular-nums text-amber-11">
          {member.grade ?? "—"} <Star size={11} fill="currentColor" />
        </span>
      </div>
      {member.task_description && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{member.task_description}</p>}
      {member.grade_remarks && <p className="mt-1.5 text-xs italic text-muted-foreground">“{member.grade_remarks}”</p>}
    </li>
  );
}

/** HR's sign-off on one graded group task, inside the sheet. Keys: Enter verify, X return. */
function GroupTaskReview({ item, onVerify, onReturn, isSubmitting, onDecided, searchTerm }) {
  const task = item.source;
  const members = task.members || [];
  const graded = members.filter((m) => m.grade != null);
  const average = graded.length ? (graded.reduce((sum, m) => sum + Number(m.grade), 0) / graded.length).toFixed(1) : null;
  const [note, setNote] = useState("");
  const noteRef = useRef(null);

  const run = async (action, { loading, success, failure }) => {
    const id = toast.loading(loading);
    try {
      await action(note);
      toast.success(success, { id, duration: 4000 });
      onDecided();
    } catch (err) {
      toast.error(err?.message || failure, { id, duration: 4000 });
    }
  };

  const verify = () => {
    if (isSubmitting) return;
    run(onVerify, { loading: "Verifying group task…", success: "Group task verified.", failure: "Could not verify the group task." });
  };

  const reject = () => {
    if (isSubmitting) return;
    if (!note.trim()) {
      toast.error("Add audit notes so the head knows what to fix.");
      noteRef.current?.focus();
      return;
    }
    run(onReturn, { loading: "Returning group task…", success: "Group task returned to the head.", failure: "Could not return the group task." });
  };

  useEffect(() => {
    const onKey = (e) => {
      const action = resolveApprovalShortcut(e, { isHr: true, isReadOnly: false });
      if (action === "submit") {
        e.preventDefault();
        verify();
      } else if (action === "reject") {
        e.preventDefault();
        reject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <SlideOverBody>
        <PersonChip person={item.person} size="lg" />

        <DetailSection title="Details">
          <dl className="divide-y divide-border/70">
            <DetailRow label="Members">{members.length}</DetailRow>
            <DetailRow label="Average grade">{average && <span className="font-mono tabular-nums">{average} / 5</span>}</DetailRow>
            {task.due_date && <DetailRow label="Due">{formatDate(task.due_date)}</DetailRow>}
            <DetailRow label="Created">{formatDate(task.created_at)}</DetailRow>
            <DetailRow label="Waiting">
              <span className={item.isStale ? "font-semibold text-amber-11" : ""}>{relativeAge(item.clockAt).replace(" ago", "")}</span>
            </DetailRow>
          </dl>
        </DetailSection>

        {task.description && (
          <DetailSection title="Brief">
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
              <HighlightText text={task.description} search={searchTerm} />
            </p>
          </DetailSection>
        )}

        <DetailSection title={`Member evaluations · ${members.length}`}>
          <ul className="space-y-2">
            {members.map((m) => (
              <MemberEvaluation key={m.id} member={m} searchTerm={searchTerm} />
            ))}
          </ul>
        </DetailSection>

        <DetailSection title="Approval chain">
          <ApprovalChain chain={item.chain} />
        </DetailSection>
      </SlideOverBody>

      <SlideOverFooter>
        <Textarea
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          aria-label="HR audit notes"
          placeholder="Add HR audit notes (required to return)"
          className="min-h-0 resize-none bg-card text-[13px] md:text-[13px]"
        />
        <NotePresets presets={NOTE_PRESETS.hr} onPick={(q) => setNote((n) => (n ? `${n} ${q}` : q))} />
        <div className="flex gap-2">
          <Button variant="destructive" className="flex-1" onClick={reject} disabled={isSubmitting} title="Shortcut: X">
            Return
          </Button>
          <Button className={`flex-1 ${APPROVE_CLASS}`} onClick={verify} disabled={isSubmitting} title="Shortcut: Enter">
            Verify & sign
          </Button>
        </div>
      </SlideOverFooter>
    </>
  );
}

/** HR verification for group tasks: the Approval Center's table and slide-over, same as every other queue. */
export default function GroupTaskApprovalSection({ searchTerm = "", onClearSearch }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { recordId, open: openRecord, step: stepRecord, close: closeRecord } = useRecordParam();

  const { data: groupTasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["groupTasksForHR"],
    queryFn: () => groupTaskService.getGroupTasks(user.id, false, true), // HR sees all
    enabled: !!user?.id,
  });

  const items = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return groupTasks
      .filter((t) => t.status === "HR_PENDING")
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.creator?.name?.toLowerCase().includes(q))
      .map((t) => groupTaskToItem(t));
  }, [groupTasks, searchTerm]);

  const index = items.findIndex((i) => i.id === recordId);
  const open = index >= 0 ? items[index] : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["groupTasksForHR"] });
  const verifyMutation = useMutation({
    mutationFn: ({ id, remarks }) => groupTaskService.verifyGroupTask(id, user.id, remarks),
    onSuccess: refresh,
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }) => groupTaskService.rejectGroupTask(id, user.id, remarks),
    onSuccess: refresh,
  });

  if (isError) return <QueryError title="Group tasks could not be loaded." onRetry={refetch} />;

  if (isLoading) {
    return (
      <PageLoading label="group tasks" />
    );
  }

  return (
    <>
      <ApprovalTable
        items={items}
        queueIcon={QUEUE.icon}
        personLabel="Created by"
        onOpen={(item) => openRecord(item.id)}
        searchTerm={searchTerm}
        filtered={groupTasks.some((t) => t.status === "HR_PENDING")}
        onClearFilters={onClearSearch}
        keyboard={!open}
        renderRowAction={(item) => (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openRecord(item.id)}>
            Verify
          </Button>
        )}
        empty={{ title: "No Group Tasks Pending", description: "Graded group tasks awaiting HR verification will appear here." }}
      />

      <ApprovalSheet
        item={open}
        queueLabel={QUEUE.label}
        queueIcon={QUEUE.icon}
        index={index}
        total={items.length}
        onStep={(d) => {
          const to = items[index + d];
          if (to) stepRecord(to.id);
        }}
        onClose={closeRecord}
        onOpenDetails={(item) =>
          window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: item.id, type: "GROUP_TASK" } }))
        }
      >
        {(item) => (
          <GroupTaskReview
            key={item.id}
            item={item}
            searchTerm={searchTerm}
            isSubmitting={verifyMutation.isPending || rejectMutation.isPending}
            onVerify={(remarks) => verifyMutation.mutateAsync({ id: item.id, remarks })}
            onReturn={(remarks) => rejectMutation.mutateAsync({ id: item.id, remarks })}
            onDecided={() => {
              const next = items[index + 1] || items[index - 1];
              if (next) stepRecord(next.id);
              else closeRecord();
            }}
          />
        )}
      </ApprovalSheet>
    </>
  );
}
