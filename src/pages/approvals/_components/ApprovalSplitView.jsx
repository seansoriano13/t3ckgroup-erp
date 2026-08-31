import { useCallback, useEffect, useRef, useState } from "react";
import { ApprovalQueueItem } from "./ApprovalQueueItem";
import { ApprovalDetailPane } from "./ApprovalDetailPane";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, X, Loader2 } from "lucide-react";
import {
  deriveVisibleCount,
  neighbourTaskId,
  reconcileActiveTaskId,
  resolveNavigationKey,
} from "../../../utils/approvalQueue.js";

const INITIAL_BATCH_SIZE = 25;
const BATCH_INCREMENT = 25;

// Module-level so the default does not allocate a fresh Set on every render and
// re-run everything downstream that depends on its identity.
const NO_REPLIES = new Set();

export function ApprovalSplitView({
  tasks = [],
  isHr = false,
  isVerifiedTab = false,
  currentUserId,
  onProcessTask,
  isSubmitting = false,
  onViewFullDetails,
  selectedTaskIds = [],
  onToggleTaskSelection,
  enableBulkApproval = true,
  searchTerm = "",
  repliedTaskIds = NO_REPLIES,
  activeTaskId,
  onSelectTaskId,
  emptyMessage,
}) {
  const [autoAdvance, setAutoAdvance] = useState(() => {
    try {
      const saved = localStorage.getItem("approval_auto_advance");
      return saved !== null ? JSON.parse(saved) : true;
    } catch {
      return true;
    }
  });

  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // How far the reviewer has pulled the queue open. Held as a floor rather than
  // an exact count so the rendered window can be *derived*: clamped to the
  // dataset and always stretched far enough to include the active row. That
  // removes the two effects this used to need to keep the window in step with
  // the list, and with them the cascading renders they caused.
  const [requestedCount, setRequestedCount] = useState(INITIAL_BATCH_SIZE);
  const queueScrollRef = useRef(null);
  const sentinelRef = useRef(null);

  const handleSetAutoAdvance = (val) => {
    setAutoAdvance(val);
    try {
      localStorage.setItem("approval_auto_advance", JSON.stringify(val));
    } catch {
      // Private-mode or quota-full storage: the preference just does not persist.
    }
  };

  // Find index of currently active task in the whole dataset
  const activeIndex = tasks.findIndex((t) => t.id === activeTaskId);
  const currentTask = activeIndex >= 0 ? tasks[activeIndex] : tasks[0] || null;

  // Jumping straight to a deep-linked task pulls the window down to it, so the
  // selected row is always in the list the reviewer can see.
  const visibleCount = deriveVisibleCount({
    requestedCount,
    activeIndex,
    total: tasks.length,
  });

  // Approving a task drops it out of the queue; move the selection on rather
  // than leaving the pane pointed at a row that is no longer there.
  const reconciledId = reconcileActiveTaskId(tasks, activeTaskId);
  useEffect(() => {
    if (reconciledId !== activeTaskId) onSelectTaskId?.(reconciledId);
  }, [reconciledId, activeTaskId, onSelectTaskId]);

  // Keep the active task visible in the queue scroll container whenever it changes (e.g. J / K navigation)
  useEffect(() => {
    if (!activeTaskId || !queueScrollRef.current) return;
    const targetEl = queueScrollRef.current.querySelector(
      `[data-task-id="${activeTaskId}"]`
    );
    if (targetEl) {
      targetEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeTaskId, visibleCount]);

  // IntersectionObserver on scroll sentinel for lazy loading
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && visibleCount < tasks.length) {
          setRequestedCount((prev) => prev + BATCH_INCREMENT);
        }
      },
      {
        root: queueScrollRef.current,
        rootMargin: "150px",
        threshold: 0.1,
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, tasks.length]);

  const handleNavigateNext = useCallback(() => {
    const nextId = neighbourTaskId(tasks, activeIndex, "next");
    if (nextId) onSelectTaskId?.(nextId);
  }, [activeIndex, tasks, onSelectTaskId]);

  const handleNavigatePrev = useCallback(() => {
    const prevId = neighbourTaskId(tasks, activeIndex, "prev");
    if (prevId) onSelectTaskId?.(prevId);
  }, [activeIndex, tasks, onSelectTaskId]);

  // J / K (and the arrow keys) walk the queue, from anywhere on the page except
  // a text field the reviewer is typing into.
  useEffect(() => {
    const handleKeyDown = (e) => {
      const direction = resolveNavigationKey(e);
      if (!direction) return;
      e.preventDefault();
      if (direction === "next") handleNavigateNext();
      else handleNavigatePrev();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNavigateNext, handleNavigatePrev]);

  // Slice tasks for scalable DOM rendering
  const visibleTasks = tasks.slice(0, visibleCount);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-card border border-border rounded-2xl shadow-xs text-center p-8">
        <div className="p-4 bg-muted/60 rounded-full mb-4 ring-4 ring-muted/30">
          <CheckCircle2 className="w-8 h-8 text-muted-foreground" />
        </div>
        <p className="text-foreground font-bold text-lg">
          {emptyMessage?.title || "Inbox Zero!"}
        </p>
        <p className="text-muted-foreground mt-1.5 text-xs sm:text-sm max-w-sm">
          {emptyMessage?.description || "All pending items have been reviewed."}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* LEFT COLUMN: SCROLLABLE QUEUE LIST (5 cols on lg, 4 cols on xl) */}
      <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between px-1 text-xs font-bold text-muted-foreground">
          <span>Queue ({visibleTasks.length} of {tasks.length})</span>
          <span className="text-[11px] font-medium opacity-70">
            J / K to navigate
          </span>
        </div>

        <div
          ref={queueScrollRef}
          data-approval-queue=""
          className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-210px)] pr-1 focus:outline-none"
        >
          {visibleTasks.map((task) => (
            <ApprovalQueueItem
              key={task.id}
              task={task}
              isActive={task.id === (currentTask?.id || activeTaskId)}
              onSelect={() => {
                onSelectTaskId?.(task.id);
                // On mobile screens, open the sheet modal
                if (window.innerWidth < 1024) {
                  setMobileDetailOpen(true);
                }
              }}
              isSelected={selectedTaskIds.includes(task.id)}
              onToggleSelection={onToggleTaskSelection}
              enableBulkSelection={enableBulkApproval}
              searchTerm={searchTerm}
              isReplied={repliedTaskIds.has(task.id)}
              isVerifiedTab={isVerifiedTab}
            />
          ))}

          {/* Lazy Load Sentinel & Indicator */}
          {visibleCount < tasks.length && (
            <div
              ref={sentinelRef}
              className="py-3 flex items-center justify-center text-xs text-muted-foreground gap-2 font-medium"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Loading more tasks ({visibleTasks.length} / {tasks.length})...</span>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: STICKY DETAIL PANE (Desktop lg+) */}
      <div className="hidden lg:block lg:col-span-7 xl:col-span-8 sticky top-4 h-[calc(100vh-160px)] min-h-[550px]">
        <ApprovalDetailPane
          key={currentTask?.id}
          task={currentTask}
          isHr={isHr}
          isVerifiedTab={isVerifiedTab}
          onProcess={onProcessTask}
          isSubmitting={isSubmitting}
          currentUserId={currentUserId}
          onViewFullDetails={onViewFullDetails}
          autoAdvance={autoAdvance}
          setAutoAdvance={handleSetAutoAdvance}
          onNavigateNext={handleNavigateNext}
          onNavigatePrev={handleNavigatePrev}
          hasNext={activeIndex < tasks.length - 1}
          hasPrev={activeIndex > 0}
          queueIndex={activeIndex + 1}
          totalInQueue={tasks.length}
          searchTerm={searchTerm}
        />
      </div>

      {/* MOBILE / TABLET DETAIL DRAWER / MODAL */}
      <Dialog open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
        <DialogContent
          showCloseButton={false}
          className="p-0 gap-0 z-[70] w-full max-w-[95vw] sm:max-w-[650px] max-h-[92vh] h-[92vh] rounded-2xl overflow-hidden flex flex-col"
        >
          <div className="flex items-center justify-between px-4 py-2 bg-muted/40 border-b border-border">
            <span className="font-bold text-xs text-muted-foreground uppercase tracking-wider">
              Review Task
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-lg"
              onClick={() => setMobileDetailOpen(false)}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-hidden">
            <ApprovalDetailPane
              key={currentTask?.id}
              task={currentTask}
              isHr={isHr}
              isVerifiedTab={isVerifiedTab}
              onProcess={async (payload) => {
                await onProcessTask(payload);
                if (autoAdvance && activeIndex >= tasks.length - 1) {
                  setMobileDetailOpen(false);
                }
              }}
              isSubmitting={isSubmitting}
              currentUserId={currentUserId}
              onViewFullDetails={onViewFullDetails}
              autoAdvance={autoAdvance}
              setAutoAdvance={handleSetAutoAdvance}
              onNavigateNext={handleNavigateNext}
              onNavigatePrev={handleNavigatePrev}
              hasNext={activeIndex < tasks.length - 1}
              hasPrev={activeIndex > 0}
              queueIndex={activeIndex + 1}
              totalInQueue={tasks.length}
              searchTerm={searchTerm}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
