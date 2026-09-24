import { useState, useEffect } from "react";
import ModalOverlay from "../../components/ui/ModalOverlay";
import {
  X,
  ChevronDown,
  ChevronRight,
  Search,
  HelpCircle,
  Maximize2,
  BookOpen,
} from "lucide-react";
import { ICON_MAP } from "./faqData";
import { loadFAQFromDB } from "../../services/faqService";
import { useNavigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { Button } from "@/components/ui/button";
import HighlightText from "../../components/HighlightText";
import { canEditFAQ as canEditFAQPredicate } from "../../utils/faqAccess";
import { Input } from "@/components/ui/input";

// ─── Role helpers ──────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  employee: "Standard Employee",
  head: "Head / Manager",
  hr: "HR",
  super_admin: "Super Admin",
};

function getUserRole(user) {
  if (!user) return "employee";
  if (user.isSuperAdmin || user.is_super_admin) return "super_admin";
  if (user.isHr || user.is_hr) return "hr";
  if (user.isHead || user.is_head) return "head";
  return "employee";
}

// Returns the answer text appropriate for the given role.
// Falls back to the shared `a` field if no custom role answer exists.
function getAnswerForRole(item, roleKey) {
  const custom = item.roleAnswers?.[roleKey];
  if (custom !== null && custom !== undefined && custom.trim() !== "")
    return custom;
  return item.a;
}

// ─── Single accordion item ─────────────────────────────────────────────────────
function FAQItem({ question, answer, isOpen, onToggle, hasRoleCustom, searchTerm }) {
  const lines = answer.split("\n");
  return (
    <div
      className={`border border-border rounded-xl overflow-hidden transition-all duration-200 ${
        isOpen ? "bg-card shadow-sm" : "bg-card hover:bg-muted/40"
      }`}
    >
      <Button
        variant="ghost"
        onClick={onToggle}
        className="h-auto w-full items-start justify-start gap-3 rounded-none px-4 py-3.5 text-left font-normal"
        id={`faq-q-${question.slice(0, 20).replace(/\s+/g, "-").toLowerCase()}`}
      >
        <span
          className={`mt-0.5 shrink-0 transition-colors ${isOpen ? "text-primary" : "text-muted-foreground"}`}
        >
          {isOpen ? (
            <ChevronDown size={16} strokeWidth={2.5} />
          ) : (
            <ChevronRight size={16} strokeWidth={2.5} />
          )}
        </span>
        <span
          className={`text-sm font-semibold leading-snug transition-colors ${isOpen ? "text-foreground" : "text-foreground/80"}`}
        >
          <HighlightText text={question} search={searchTerm} />
        </span>
        {hasRoleCustom && (
          <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
            For you
          </span>
        )}
      </Button>

      {isOpen && (
        <div className="px-4 pb-4 pl-10 animate-content-in">
          <div className="space-y-1.5">
            {lines.map((line, idx) => (
              <p
                key={idx}
                className="text-sm text-muted-foreground leading-relaxed"
              >
                <HighlightText text={line} search={searchTerm} />
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sidebar category list ─────────────────────────────────────────────────────
function CategorySidebar({ categories, activeId, onSelect }) {
  return (
    <div className="w-52 shrink-0 space-y-0.5 py-1">
      {categories.map((cat) => {
        const Icon = ICON_MAP[cat.icon] ?? BookOpen;
        const isActive = activeId === cat.id;
        return (
          <Button
            key={cat.id}
            variant="ghost"
            onClick={() => onSelect(cat.id)}
            className={`h-auto w-full justify-start gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium ${
              isActive
                ? "bg-muted text-foreground font-semibold hover:bg-muted"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <span
              className="w-5 h-5 flex items-center justify-center shrink-0"
              style={{ color: isActive ? cat.color : undefined }}
            >
              <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
            </span>
            <span className="truncate">{cat.label}</span>
          </Button>
        );
      })}
    </div>
  );
}

// ─── Main modal ────────────────────────────────────────────────────────────────
export default function FAQModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userRole = getUserRole(user);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState(null);
  const [openItem, setOpenItem] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(isOpen);
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);

  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setLoading(true);
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  const canEditFAQ = canEditFAQPredicate(user);

  // Load FAQ data from Supabase whenever the modal opens
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    loadFAQFromDB()
      .then((fresh) => {
        if (cancelled) return;
        setCategories(fresh);
        setActiveCategory((prev) => {
          if (prev && fresh.some((c) => c.id === prev)) return prev;
          return fresh[0]?.id ?? null;
        });
      })
      .catch((err) => {
        console.error("[FAQModal] Failed to load FAQ data:", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const resolvedActive = activeCategory ?? categories[0]?.id;
  const isSearching = searchQuery.trim().length > 0;

  // Build search results using role-aware answers
  const searchResults = isSearching
    ? categories.flatMap((cat) =>
        cat.items
          .filter((item) => {
            const ans = getAnswerForRole(item, userRole);
            return (
              item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
              ans.toLowerCase().includes(searchQuery.toLowerCase())
            );
          })
          .map((item) => ({
            ...item,
            categoryLabel: cat.label,
            categoryColor: cat.color,
          })),
      )
    : [];

  const activeData = categories.find((c) => c.id === resolvedActive);
  const toggleItem = (key) =>
    setOpenItem((prev) => (prev === key ? null : key));
  const totalItems = categories.reduce((acc, c) => acc + c.items.length, 0);

  return (
    <ModalOverlay isOpen={isOpen} onClose={onClose}>

      {/* Panel */}
      <div className="relative z-10 w-full max-w-4xl h-[82vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden modal-enter">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
              <HelpCircle size={16} className="text-muted-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground leading-tight">
                Help &amp; FAQ
              </h2>
              <p className="text-[11px] text-muted-foreground leading-tight">
                T3CKGROUP Task Monitoring System
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Navigate to FAQ Editor page */}
            {canEditFAQ && (
              <Button
                id="open-faq-editor-btn"
                variant="outline"
                onClick={() => {
                  onClose();
                  navigate("/settings/FAQEditor");
                }}
                className="h-auto gap-1.5 rounded-lg bg-card px-3 py-1.5 text-xs font-medium"
                title="Open FAQ Editor"
              >
                <Maximize2 size={13} />
                Edit
              </Button>
            )}

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X size={15} strokeWidth={2.5} />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-border bg-muted/20 shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="text"
              placeholder="Search questions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              containerClassName="w-full" className="pl-9 pr-4 placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          {!isSearching && (
            <div className="px-3 py-4 border-r border-border bg-muted/10 overflow-y-auto scrollbar-thin shrink-0">
              <CategorySidebar
                categories={categories}
                activeId={resolvedActive}
                onSelect={(id) => {
                  setActiveCategory(id);
                  setOpenItem(null);
                }}
              />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-5">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin mb-3" />
                <p className="text-sm">Loading FAQ…</p>
              </div>
            ) : categories.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <HelpCircle size={32} className="mb-3 opacity-30" />
                <p className="text-sm font-semibold">No FAQ content yet</p>
                {canEditFAQ ? (
                  <>
                    <p className="text-xs mt-1 opacity-70">
                      Click Edit to add categories and questions
                    </p>
                    <Button
                      onClick={() => {
                        onClose();
                        navigate("/settings/FAQEditor");
                      }}
                      className="mt-4 h-auto gap-1.5 rounded-lg px-4 py-2 text-xs font-medium hover:opacity-90"
                    >
                      <Maximize2 size={12} />
                      Open Editor
                    </Button>
                  </>
                ) : (
                  <p className="text-xs mt-1 opacity-70">
                    Check back later for updates
                  </p>
                )}
              </div>
            ) : isSearching ? (
              <div className="space-y-3">
                {searchResults.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <HelpCircle
                      size={32}
                      className="text-muted-foreground/40 mb-3"
                    />
                    <p className="text-sm font-semibold text-muted-foreground">
                      No results found
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      Try different keywords
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-[11px] text-muted-foreground font-semibold uppercase tracking-widest mb-4">
                      {searchResults.length} result
                      {searchResults.length !== 1 ? "s" : ""}
                    </p>
                    {searchResults.map((item, idx) => (
                      <div key={idx}>
                        <p
                          className="text-[10px] font-bold uppercase tracking-widest mb-1.5"
                          style={{ color: item.categoryColor }}
                        >
                          {item.categoryLabel}
                        </p>
                        <FAQItem
                          question={item.q}
                          answer={getAnswerForRole(item, userRole)}
                          hasRoleCustom={
                            item.roleAnswers?.[userRole] != null &&
                            item.roleAnswers[userRole].trim() !== ""
                          }
                          isOpen={openItem === `search-${idx}`}
                          onToggle={() => toggleItem(`search-${idx}`)}
                          searchTerm={searchQuery}
                        />
                      </div>
                    ))}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 mb-5">
                  {activeData && (
                    <>
                      {(() => {
                        const Icon = ICON_MAP[activeData.icon] ?? BookOpen;
                        return (
                          <Icon
                            size={18}
                            style={{ color: activeData.color }}
                            strokeWidth={2}
                          />
                        );
                      })()}
                      <h3 className="text-base font-bold text-foreground">
                        {activeData.label}
                      </h3>
                      <span className="ml-auto text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
                        {activeData.items.length} question
                        {activeData.items.length !== 1 ? "s" : ""}
                      </span>
                    </>
                  )}
                </div>

                {activeData?.items.map((item, idx) => (
                  <FAQItem
                    key={item.id ?? idx}
                    question={item.q}
                    answer={getAnswerForRole(item, userRole)}
                    hasRoleCustom={
                      item.roleAnswers?.[userRole] != null &&
                      item.roleAnswers[userRole].trim() !== ""
                    }
                    isOpen={openItem === `${resolvedActive}-${idx}`}
                    onToggle={() => toggleItem(`${resolvedActive}-${idx}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/10 shrink-0 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Can&apos;t find what you&apos;re looking for? Contact your Super
            Admin.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-muted-foreground/50 bg-muted px-2 py-0.5 rounded-full">
              {ROLE_LABELS[userRole]}
            </span>
            <p className="text-[11px] text-muted-foreground/50 font-mono">
              {totalItems} articles
            </p>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
