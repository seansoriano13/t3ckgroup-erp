import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { systemUpdateService } from "../services/systemUpdateService";
import { githubService } from "../services/githubService";
import { aiService } from "../services/aiService";
import { useAuth } from "../context/AuthContext";
import { employeeService } from "../services/employeeService";
import MentionTextarea from "./ui/MentionTextarea";
import {
  Bot,
  Plus,
  Trash2,
  Edit3,
  Github,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Megaphone,
  Rocket,
  Wrench,
  Radio,
  Check,
} from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import toast from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import { confirmDeleteToast } from "./ui/CustomToast.jsx";
import TabGroup from "./ui/TabGroup";
import { Button } from "./ui/button";

import { Textarea } from "@/components/ui/textarea";
const MAX_CONTENT_LENGTH = 2000;
const HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 30];

const TYPE_OPTIONS = [
  {
    value: "announcement",
    label: "Announcement",
    icon: Megaphone,
    description: "General company-wide notice",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200",
  },
  {
    value: "feature",
    label: "New Feature",
    icon: Rocket,
    description: "Product update or new release",
    color: "text-blue-11",
    bg: "bg-blue-2 border-blue-4",
  },
  {
    value: "fix",
    label: "System Fix",
    icon: Wrench,
    description: "Bug fix or performance patch",
    color: "text-green-10",
    bg: "bg-green-2 border-green-4",
  },
];

const getStatusStyles = (update) => {
  if (!update.is_active) return "bg-muted text-muted-foreground border-border";
  return "bg-green-2 text-green-11 border-green-4";
};

export default function SystemUpdateManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);

  const [content, setContent] = useState("");
  const [type, setType] = useState("feature");
  const [editingId, setEditingId] = useState(null);
  const [inlineEditId, setInlineEditId] = useState(null);
  const [inlineEditContent, setInlineEditContent] = useState("");
  const [inlineEditType, setInlineEditType] = useState("feature");
  const [isGenerating, setIsGenerating] = useState(false);
  const [mentions, setMentions] = useState([]);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyFilter, setHistoryFilter] = useState("all");

  const { data: pagedUpdates, isLoading } = useQuery({
    queryKey: [
      "allSystemUpdates",
      {
        page: historyPage,
        pageSize: historyPageSize,
        filter: historyFilter,
      },
    ],
    queryFn: () =>
      systemUpdateService.getUpdatesPage({
        page: historyPage,
        pageSize: historyPageSize,
        filter: historyFilter,
      }),
  });
  const updates = pagedUpdates?.items || [];
  const totalPages = pagedUpdates?.totalPages || 1;
  const totalCount = pagedUpdates?.totalCount || 0;

  const generateAIContent = async () => {
    setIsGenerating(true);
    try {
      const commits = await githubService.getRecentCommits(15);
      if (commits.length === 0) {
        toast("No recent commits found.", { icon: "ℹ️" });
        setIsGenerating(false);
        return;
      }

      const summary = await aiService.summarizeCommits(commits);
      setContent(summary);
      setType("feature");
      toast.success("Generated summary from GitHub commits!");
    } catch (error) {
      toast.error(error.message || "Failed to generate AI summary");
    } finally {
      setIsGenerating(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: (data) => systemUpdateService.createUpdate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allSystemUpdates"] });
      queryClient.invalidateQueries({ queryKey: ["activeSystemUpdates"] });
      setContent("");
      toast.success("Update broadcasted successfully!");
    },
    onError: (err) => toast.error(err.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }) => systemUpdateService.editUpdate(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allSystemUpdates"] });
      queryClient.invalidateQueries({ queryKey: ["activeSystemUpdates"] });
      setContent("");
      setEditingId(null);
      toast.success("Update edited successfully!");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }) =>
      systemUpdateService.toggleUpdateStatus(id, isActive),
    onSuccess: (_, { isActive }) => {
      queryClient.invalidateQueries({ queryKey: ["allSystemUpdates"] });
      queryClient.invalidateQueries({ queryKey: ["activeSystemUpdates"] });
      toast.success(isActive ? "Banner activated!" : "Banner deactivated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => systemUpdateService.deleteUpdate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["allSystemUpdates"] });
      queryClient.invalidateQueries({ queryKey: ["activeSystemUpdates"] });
    },
  });

  const handlePost = () => {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      toast.error("Update content cannot be empty.");
      return;
    }
    if (trimmedContent.length > MAX_CONTENT_LENGTH) {
      toast.error(
        `Keep update content within ${MAX_CONTENT_LENGTH} characters.`,
      );
      return;
    }

    if (editingId) {
      editMutation.mutate({
        id: editingId,
        data: { content: trimmedContent, type },
      });
    } else {
      createMutation.mutate({
        content: trimmedContent,
        type,
        user_id: user.id,
      });
    }
  };

  const isPosting = createMutation.isPending || editMutation.isPending;

  return (
    <div>
      {/* ── Header ──────────────────────────────────────── */}
      <div
        className={`flex items-center justify-between px-5 py-4 ${isOpen ? "border-b border-border/60" : ""}`}
      >
        <div>
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            System updates banner
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Manage the "What's New" banner shown on the dashboard.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setIsOpen(!isOpen)}
          className="h-auto flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground bg-muted/40 hover:bg-muted/80 px-3 py-1.5 rounded-lg transition-colors"
        >
          {isOpen ? (
            <>
              <ChevronUp size={13} />
              Close
            </>
          ) : (
            <>
              <Edit3 size={13} />
              Manage Updates
            </>
          )}
        </Button>
      </div>

      {isOpen && (
        <div className="animate-slide-down">
          {/* ── Compose Section ─────────────────────────────── */}
          <div className="px-5 pt-4 pb-5 border-b border-border/40">
            {/* Label + AI Button */}
            <div className="flex items-center justify-between mb-3">
              <p className="text-label font-bold text-muted-foreground uppercase tracking-widest">
                {editingId ? "Editing Broadcast" : "New Broadcast"}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={generateAIContent}
                disabled={isGenerating}
                className="h-auto flex items-center gap-1.5 text-[11px] font-bold text-mauve-9 hover:text-mauve-11 bg-mauve-9/10 hover:bg-mauve-9/15 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              >
                {isGenerating ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    <Bot size={12} />
                    <Github size={12} />
                  </>
                )}
                {isGenerating ? "Analyzing commits…" : "AI via GitHub"}
              </Button>
            </div>

            {/* Textarea */}
            <MentionTextarea
              className="w-full bg-muted/30 border border-border rounded-xl p-3.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-mauve-7 focus:outline-none focus:ring-1 ring-mauve-7 min-h-[110px] resize-none transition-all custom-scrollbar"
              placeholder="What's new? Announce a feature, fix, or important notice to the entire team…"
              value={content}
              onChange={setContent}
              people={employees}
              mentions={mentions}
              onMentionsChange={setMentions}
              maxLength={MAX_CONTENT_LENGTH + 200}
              rows={4}
            />
            <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
              {content.trim().length} / {MAX_CONTENT_LENGTH}
            </p>

            {/* Type Selector Cards */}
            <div className="grid grid-cols-3 gap-2 mt-3">
              {TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const isSelected = type === opt.value;
                return (
                  <Button
                    key={opt.value}
                    type="button"
                    variant="outline"
                    onClick={() => setType(opt.value)}
                    className={`h-auto flex flex-col items-start gap-1 p-3 rounded-xl text-left transition-all ${
                      isSelected
                        ? `${opt.bg}`
                        : "bg-muted/20 border-border hover:bg-muted/40"
                    }`}
                  >
                    <Icon
                      size={14}
                      className={isSelected ? opt.color : "text-muted-foreground"}
                    />
                    <span
                      className={`text-[11px] font-bold ${
                        isSelected ? opt.color : "text-foreground"
                      }`}
                    >
                      {opt.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground leading-tight">
                      {opt.description}
                    </span>
                  </Button>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 mt-4">
              {editingId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingId(null);
                    setContent("");
                  }}
                  className="h-auto text-[13px] font-bold text-muted-foreground/80 hover:text-foreground px-4 py-2 rounded-xl hover:bg-muted/50 transition-all"
                >
                  Cancel Edit
                </Button>
              )}
              <Button
                onClick={handlePost}
                disabled={!content.trim() || isPosting}
                className="h-9 px-6 rounded-xl text-[13px] font-black shadow-lg shadow-mauve-4 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isPosting ? (
                  <>
                    <Spinner size="sm" />
                    <span>{editingId ? "Saving…" : "Sending…"}</span>
                  </>
                ) : (
                  <>
                    {editingId ? <Edit3 size={14} /> : <Megaphone size={14} />}
                    <span>{editingId ? "Save Edit" : "Send Broadcast"}</span>
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* ── History ─────────────────────────────────────── */}
          <div className="px-5 py-4">
            {/* History Header */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-label font-bold text-muted-foreground uppercase tracking-widest">
                History
              </p>
              <div className="flex items-center gap-2">
                <TabGroup
                  type="pill"
                  tabs={[
                    { value: "all", label: "All" },
                    { value: "active", label: "Active" },
                    { value: "expired", label: "Expired/Inactive" },
                  ]}
                  activeTab={historyFilter}
                  onChange={(v) => {
                    setHistoryFilter(v);
                    setHistoryPage(1);
                  }}
                />
                {/* Page size pills */}
                <div className="flex items-center gap-1">
                  {HISTORY_PAGE_SIZE_OPTIONS.map((size) => (
                    <Button
                      key={size}
                      variant="ghost"
                      onClick={() => {
                        setHistoryPageSize(size);
                        setHistoryPage(1);
                      }}
                      className={`h-auto px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                        historyPageSize === size
                          ? "bg-muted border-border text-foreground hover:bg-muted"
                          : "border-transparent text-muted-foreground hover:bg-muted/60"
                      }`}
                    >
                      {size}
                    </Button>
                  ))}
                  <span className="text-[10px] text-muted-foreground/60 pl-0.5">
                    /page
                  </span>
                </div>
              </div>
            </div>

            {/* Update list */}
            <div className="space-y-2">
              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner size="sm" />
                </div>
              ) : updates.length === 0 ? (
                <div className="py-6 text-center">
                  <Radio
                    size={24}
                    className="mx-auto text-muted-foreground/30 mb-2"
                  />
                  <p className="text-xs text-muted-foreground italic">
                    No broadcasts yet.
                  </p>
                </div>
              ) : (
                updates.map((update) => {
                  const typeOpt = TYPE_OPTIONS.find(
                    (t) => t.value === update.type,
                  );
                  const Icon = typeOpt?.icon || Megaphone;
                  return (
                    <div
                      key={update.id}
                      className="flex gap-3 bg-muted/20 border border-border/60 rounded-xl p-3 group/item hover:bg-muted/30 transition-colors"
                    >
                      {/* Toggle */}
                      <Button
                        variant="ghost"
                        onClick={() =>
                          toggleMutation.mutate({
                            id: update.id,
                            isActive: !update.is_active,
                          })
                        }
                        className={`h-5 w-9 p-0 mt-0.5 rounded-full shrink-0 relative transition-colors ${
                          update.is_active
                            ? "bg-green-9 hover:bg-green-9"
                            : "bg-muted-foreground/30 hover:bg-muted-foreground/30"
                        }`}
                        title={update.is_active ? "Deactivate" : "Activate"}
                      >
                        <div
                          className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-all shadow-sm ${
                            update.is_active ? "left-[18px]" : "left-[3px]"
                          }`}
                        />
                      </Button>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <Icon
                              size={12}
                              className={typeOpt?.color || "text-muted-foreground"}
                            />
                            <span className="text-label font-bold text-muted-foreground uppercase tracking-wide">
                              {update.type}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {new Date(
                                update.created_at,
                              ).toLocaleDateString()}
                            </span>
                            <span
                              className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${getStatusStyles(update)}`}
                            >
                              {update.is_active ? "Live" : "Off"}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover/item:opacity-100 transition-opacity">
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                if (inlineEditId === update.id) {
                                  setInlineEditId(null);
                                } else {
                                  setInlineEditId(update.id);
                                  setInlineEditContent(update.content);
                                  setInlineEditType(update.type);
                                }
                              }}
                              className={`h-auto w-auto hover:bg-transparent transition-colors ${
                                inlineEditId === update.id
                                  ? "text-mauve-12"
                                  : "text-mauve-7 hover:text-mauve-12"
                              }`}
                              title={
                                inlineEditId === update.id
                                  ? "Cancel Edit"
                                  : "Edit"
                              }
                            >
                              <Edit3 size={13} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              onClick={() => {
                                confirmDeleteToast(
                                  "Delete Update?",
                                  "This will permanently remove the update record.",
                                  () => deleteMutation.mutate(update.id),
                                );
                              }}
                              className="h-auto w-auto text-muted-foreground hover:text-red-500 hover:bg-transparent transition-colors"
                              title="Delete"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </div>

                        {/* Inline edit form */}
                        {inlineEditId === update.id ? (
                          <div className="mt-2 flex flex-col gap-2 animate-slide-down">
                            <Textarea
                              className="min-h-[72px] resize-none rounded-lg p-2.5 text-xs md:text-xs"
                              value={inlineEditContent}
                              onChange={(e) =>
                                setInlineEditContent(e.target.value)
                              }
                              maxLength={2000}
                            />
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {TYPE_OPTIONS.map((opt) => {
                                const Ico = opt.icon;
                                return (
                                  <Button
                                    key={opt.value}
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                      setInlineEditType(opt.value)
                                    }
                                    className={`h-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                                      inlineEditType === opt.value
                                        ? `${opt.bg} ${opt.color}`
                                        : "bg-muted/20 border-border text-muted-foreground hover:bg-muted/40"
                                    }`}
                                  >
                                    <Ico
                                      size={10}
                                      className={
                                        inlineEditType === opt.value
                                          ? opt.color
                                          : ""
                                      }
                                    />
                                    {opt.label}
                                  </Button>
                                );
                              })}
                              <div className="ml-auto flex items-center gap-1.5">
                                <Button
                                  variant="ghost"
                                  onClick={() => setInlineEditId(null)}
                                  className="h-auto px-3 py-1 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted/80 transition-all"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  disabled={
                                    !inlineEditContent.trim() ||
                                    editMutation.isPending
                                  }
                                  onClick={() => {
                                    editMutation.mutate(
                                      {
                                        id: update.id,
                                        data: {
                                          content: inlineEditContent.trim(),
                                          type: inlineEditType,
                                        },
                                      },
                                      {
                                        onSuccess: () =>
                                          setInlineEditId(null),
                                      },
                                    );
                                  }}
                                  className="h-auto px-3 py-1.5 rounded-lg text-[10px] font-black bg-primary text-white hover:bg-primary/90 transition-all flex items-center gap-1 disabled:opacity-50"
                                >
                                  {editMutation.isPending ? (
                                    <Spinner size="sm" />
                                  ) : (
                                    <Check size={10} />
                                  )}
                                  Save
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="text-xs text-foreground/80 leading-relaxed line-clamp-2">
                            <ReactMarkdown
                              components={{
                                p: ({ ...props }) => (
                                  <p className="mb-0" {...props} />
                                ),
                                ul: ({ ...props }) => (
                                  <ul
                                    className="list-disc pl-4"
                                    {...props}
                                  />
                                ),
                                li: ({ ...props }) => <li {...props} />,
                                strong: ({ ...props }) => (
                                  <strong
                                    className="font-semibold"
                                    {...props}
                                  />
                                ),
                              }}
                            >
                              {update.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}

              {/* Pagination */}
              {totalPages > 0 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-[10px] text-muted-foreground">
                    {totalCount} total • Page {historyPage} of {totalPages}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      onClick={() =>
                        setHistoryPage((p) => Math.max(1, p - 1))
                      }
                      disabled={historyPage <= 1 || isLoading}
                      className="h-auto px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted/50 disabled:opacity-40 flex items-center gap-1"
                    >
                      <ChevronLeft size={12} /> Prev
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        setHistoryPage((p) => Math.min(totalPages, p + 1))
                      }
                      disabled={historyPage >= totalPages || isLoading}
                      className="h-auto px-2 py-1 rounded-lg text-[10px] font-bold text-muted-foreground hover:bg-muted/50 disabled:opacity-40 flex items-center gap-1"
                    >
                      Next <ChevronRight size={12} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
