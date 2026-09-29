/**
 * REMOVE-BEFORE-PROD — layout "Thread". Question: is an SOR really a
 * conversation? Notes and the Journey become one timeline, told in chapters —
 * one per Stage visit, each holding the notes written while the deal sat
 * there. The current Stage is the last chapter, with its work inline, and the
 * note box sits at the bottom like any chat. A narrow status panel keeps the
 * stage, Move, value and facts in view; the long tabs slide over as a sheet.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Paperclip, Send, ShieldOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FileInput } from "@/components/ui/FileInput";
import Avatar from "../../../Avatar";
import Spinner from "../../../ui/Spinner";
import { AttachmentList, AttachmentPreviews } from "../../../ui/Attachments";
import MentionTextarea, { NoteText } from "../../../ui/MentionTextarea";
import { ALLOWED_EXTENSIONS_STRING } from "../../../../utils/attachments";
import NowTab from "../NowTab";
import Sheet from "./Sheet";
import StageStrip, { MoveButtons, TONE_BG, useJourneyVisits } from "../summary/StageStrip";
import { useDigest } from "../summary/useDigest";
import { EditBody, HeaderActions, Identity, LABEL, QuoteActions, TeamList, ValueFigure, detailRows, formatShort, showMoney, useWarmTabs } from "../summary/shared";

const DAY = 86400000;

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function NoteRow({ n, onMention }) {
  if (n.type === "SYSTEM") {
    const lines = n.metadata?.changes?.length ? n.metadata.changes : [n.content || n.metadata?.requested_name].filter(Boolean);
    return (
      <li className="flex gap-2.5 py-1">
        <Sparkles size={13} className="mt-[3px] shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
          {lines.map((l, i) => (
            <p key={i} className="break-words">
              {l}
            </p>
          ))}
          <AttachmentList attachments={n.metadata?.attachments} className="mt-1" compact />
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/80">{when(n.created_at)}</span>
      </li>
    );
  }
  return (
    <li className="flex gap-3 py-2">
      <Avatar name={n.author?.name} src={n.author?.avatar_path} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-muted-foreground">
          {n.author?.name ? (
            <Button type="button" variant="ghost" onClick={() => onMention(n.author)} title={`Mention @${n.author.name}`} className="h-auto p-0 font-bold text-foreground hover:bg-transparent hover:underline">
              {n.author.name}
            </Button>
          ) : (
            <span className="font-bold">Unknown</span>
          )}
          <span className="ml-2 tabular-nums">{when(n.created_at)}</span>
        </p>
        {n.content && <NoteText content={n.content} mentions={n.metadata?.mentions} onMentionClick={onMention} className="text-sm break-words text-foreground" />}
        <AttachmentList attachments={n.metadata?.attachments} className={n.content ? "mt-2" : "mt-1"} />
      </div>
    </li>
  );
}

function Chapter({ p, chapter, expanded, onExpand }) {
  const { visit, notes, isCurrent } = chapter;
  const hidden = !isCurrent && !expanded && notes.length > 3 ? notes.length - 2 : 0;
  const shown = hidden ? notes.slice(-2) : notes;
  const days = visit ? Math.max(0, Math.round(((visit.leftAt ? new Date(visit.leftAt) : new Date()) - new Date(visit.enteredAt)) / DAY)) : null;

  return (
    <section className="relative pb-6 pl-8">
      <span className="absolute top-2 bottom-0 left-[9px] w-px bg-border" aria-hidden />
      <span
        className={cn(
          "absolute top-[5px] left-[4px] size-[11px] rounded-full ring-4 ring-popover",
          isCurrent ? TONE_BG[p.currentFlowStageTone] || "bg-foreground" : "bg-mauve-8",
        )}
        aria-hidden
      />
      <header className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h3 className={cn("text-[15px] tracking-tight text-foreground", isCurrent ? "font-black" : "font-bold")}>
          {isCurrent && visit ? `Now · ${chapter.title}` : chapter.title}
        </h3>
        {visit && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatShort(visit.enteredAt)} → {visit.leftAt ? formatShort(visit.leftAt) : "now"} · {days} day{days === 1 ? "" : "s"}
          </span>
        )}
      </header>

      {visit?.isRestricted ? (
        <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <ShieldOff size={13} /> Restricted stage — what happened here is hidden from you.
        </p>
      ) : (
        <>
          {hidden > 0 && (
            <Button type="button" variant="ghost" size="xs" onClick={onExpand} className="-ml-2 mb-1 gap-1 text-muted-foreground">
              <ChevronDown size={12} /> Show {hidden} earlier note{hidden === 1 ? "" : "s"}
            </Button>
          )}
          {shown.length > 0 ? (
            <ul className="divide-y divide-border/40">
              {shown.map((n) => (
                <NoteRow key={n.id} n={n} onMention={p.handleMentionClick} />
              ))}
            </ul>
          ) : (
            !isCurrent && <p className="text-[13px] text-muted-foreground">No notes while in this stage.</p>
          )}
        </>
      )}

      {isCurrent && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card">
          <p className={cn(LABEL, "border-b border-border/60 px-5 py-2.5")}>This stage's work</p>
          <NowTab ctx={p.ctx} />
        </div>
      )}
    </section>
  );
}

function Composer({ p }) {
  const { attachments, isPosting } = p;
  const files = attachments.files;
  return (
    <form
      className="shrink-0 border-t border-border/60 bg-popover px-6 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        p.handlePostNote();
      }}
    >
      <FileInput ref={p.fileInputRef} multiple accept={ALLOWED_EXTENSIONS_STRING} onFiles={attachments.addFiles} />
      {files.length > 0 && (
        <div className="mb-2">
          <AttachmentPreviews files={files} onRemove={attachments.removeFile} disabled={isPosting} />
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1 rounded-xl border border-border bg-card px-3 py-2 focus-within:border-mauve-8">
          <MentionTextarea
            rows={1}
            value={p.note}
            onChange={p.setNote}
            people={p.mentionableEmployees}
            mentions={p.noteMentions}
            onMentionsChange={p.setNoteMentions}
            onPaste={attachments.addFromPaste}
            placeholder="Write a note — @ to mention, paste to attach"
            className="w-full resize-none bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          title={`Attach files (max ${attachments.max})`}
          aria-label="Attach files"
          disabled={isPosting || files.length >= attachments.max}
          onClick={() => p.fileInputRef.current?.open()}
          className="size-10 shrink-0 rounded-xl text-muted-foreground"
        >
          <Paperclip size={15} />
        </Button>
        <Button type="submit" disabled={(!p.note.trim() && files.length === 0) || isPosting} className="h-10 shrink-0 gap-1.5 rounded-xl px-4">
          {isPosting ? <Spinner size="sm" /> : <Send size={13} />}
          {attachments.isUploading ? "Uploading" : "Post"}
        </Button>
      </div>
    </form>
  );
}

function StatusPanel({ p, dg, visits, openSheet }) {
  const { opportunity } = p;
  const rows = detailRows(p).slice(0, 6);
  return (
    <aside className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-border/60 bg-mauve-2 lg:block">
      <div className="space-y-3 border-b border-border/60 p-5">
        <StageStrip p={p} visits={visits} showMoves={false} />
        <p className="text-xs text-muted-foreground">
          {dg.days != null ? `${dg.days} day${dg.days === 1 ? "" : "s"} in this stage` : "Current stage"}
          {dg.openTasks.length > 0 && ` · ${dg.openTasks.length} open task${dg.openTasks.length === 1 ? "" : "s"}`}
        </p>
        <MoveButtons p={p} />
      </div>

      {showMoney(p) && (
        <div className="space-y-3 border-b border-border/60 p-5">
          <p className={LABEL}>Estimated value</p>
          <ValueFigure p={p} className="text-2xl" />
          <QuoteActions p={p} stacked={false} />
        </div>
      )}

      <div className="border-b border-border/60 p-5">
        <div className="flex items-baseline justify-between">
          <p className={LABEL}>Products</p>
          <Button type="button" variant="ghost" size="xs" onClick={() => openSheet("items")} className="-mr-2 gap-1 text-muted-foreground hover:text-foreground">
            View <ArrowRight size={12} />
          </Button>
        </div>
        <p className="mt-1 text-[13px] font-semibold text-foreground">
          {dg.itemsCount} line{dg.itemsCount === 1 ? "" : "s"}
          {showMoney(p) && dg.itemsCount > 0 && <span className="font-normal text-muted-foreground"> · {dg.itemsTotal}</span>}
        </p>
      </div>

      <div className="border-b border-border/60 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <p className={LABEL}>Details</p>
          <Button type="button" variant="ghost" size="xs" onClick={() => openSheet("details")} className="-mr-2 gap-1 text-muted-foreground hover:text-foreground">
            All details <ArrowRight size={12} />
          </Button>
        </div>
        <dl className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.label} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-xs text-muted-foreground">{r.label}</dt>
              <dd className="min-w-0 truncate text-right text-[13px] font-semibold text-foreground">{r.value || <span className="text-muted-foreground/60">—</span>}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="p-5">
        <p className={cn(LABEL, "mb-3")}>Deal team</p>
        <TeamList opportunity={opportunity} compact />
        {showMoney(p) && (
          <Button type="button" variant="ghost" size="xs" onClick={() => openSheet("commission")} className="-ml-2 mt-3 gap-1 text-muted-foreground hover:text-foreground">
            Commission split <ArrowRight size={12} />
          </Button>
        )}
      </div>
    </aside>
  );
}

export default function ThreadLayout({ p }) {
  useWarmTabs(p, ["items", "details", "journey"]);
  const { ctx } = p;
  const dg = useDigest(p);
  const visits = useJourneyVisits(p);
  const [sheet, setSheet] = useState(null);
  const [expanded, setExpanded] = useState([]);
  const scrollRef = useRef(null);

  const chapters = useMemo(() => {
    const notes = [...p.notes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const vs = [...visits].sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt));
    if (!vs.length) return [{ key: "all", title: "Activity", visit: null, notes, isCurrent: true }];
    const t = (iso) => new Date(iso).getTime();
    const out = [];
    const before = notes.filter((n) => t(n.created_at) < t(vs[0].enteredAt));
    if (before.length) out.push({ key: "before", title: "Before the Sales Flow", visit: null, notes: before, isCurrent: false });
    vs.forEach((v, i) => {
      const start = t(v.enteredAt);
      const end = vs[i + 1] ? t(vs[i + 1].enteredAt) : Infinity;
      out.push({
        key: v.id,
        // The current chapter takes the Stage's live name, matching the header badge.
        title: i === vs.length - 1 && !v.leftAt ? p.currentFlowStage?.name || v.stage.name : v.stage.name,
        visit: v,
        notes: notes.filter((n) => t(n.created_at) >= start && t(n.created_at) < end),
        isCurrent: i === vs.length - 1 && !v.leftAt,
      });
    });
    return out;
  }, [p.notes, visits, p.currentFlowStage?.name]);

  // Open at the latest chapter, like a chat.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.id, chapters.length, p.notes.length]);

  useEffect(() => setSheet(null), [p.id]);

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/60 px-6 pt-5 pb-4">
        <Identity p={p} />
        <HeaderActions p={p} />
      </div>
      {p.windowsBanner}

      <div className="relative flex min-h-0 flex-1">
        {ctx.isEditing ? (
          <div className="min-h-0 flex-1">
            <EditBody p={p} />
          </div>
        ) : (
          <>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 pt-6">
                <div className="mx-auto max-w-3xl">
                  {p.loadingNotes ? (
                    <Spinner size="sm" />
                  ) : (
                    chapters.map((c) => (
                      <Chapter key={c.key} p={p} chapter={c} expanded={expanded.includes(c.key)} onExpand={() => setExpanded((prev) => [...prev, c.key])} />
                    ))
                  )}
                </div>
              </div>
              <Composer p={p} />
            </div>
            <StatusPanel p={p} dg={dg} visits={visits} openSheet={setSheet} />
            <Sheet p={p} view={sheet} onClose={() => setSheet(null)} onOpen={setSheet} />
          </>
        )}
      </div>
    </>
  );
}
