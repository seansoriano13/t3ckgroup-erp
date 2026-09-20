import { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Save,
  Check,
  Pencil,
  BookOpen,
  ArrowLeft,
} from "lucide-react";
import { generateId, ICON_MAP, ICON_NAMES, CATEGORY_COLORS } from "./faqData";

// ─── Role definitions ─────────────────────────────────────────────────────────
const ROLES = [
  { key: "employee",    label: "Standard Employee", short: "Employee",  color: "#2eaadc" },
  { key: "head",        label: "Head / Manager",     short: "Head",       color: "#0f7b6c" },
  { key: "hr",          label: "HR",                 short: "HR",         color: "#9065b0" },
  { key: "super_admin", label: "Super Admin",         short: "Super Admin",color: "#d9730d" },
];
import { loadFAQFromDB, saveFAQToDB } from "../../services/faqService";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import { Navigate } from "react-router";
import { useAuth } from "../../context/AuthContext";
import { canEditFAQ } from "../../utils/faqAccess";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

// ─── Tiny auto-resize textarea ────────────────────────────────────────────────
function AutoTextarea({ value, onChange, placeholder, className }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  }, [value]);
  return (
    <Textarea
      ref={ref}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      className={`min-h-0 resize-none overflow-hidden ${className}`}
    />
  );
}

// ─── Category sidebar item ─────────────────────────────────────────────────────
function CategoryItem({ cat, isActive, onClick, onDelete, onLabelChange }) {
  const Icon = ICON_MAP[cat.icon] ?? BookOpen;
  const [editingLabel, setEditingLabel] = useState(false);
  const [draft, setDraft] = useState(cat.label);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editingLabel && inputRef.current) inputRef.current.focus();
  }, [editingLabel]);

  const commit = () => {
    if (draft.trim()) onLabelChange(draft.trim());
    else setDraft(cat.label);
    setEditingLabel(false);
  };

  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all ${
        isActive
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      }`}
    >
      <span
        style={{ color: isActive ? cat.color : undefined }}
        className="shrink-0"
      >
        <Icon size={15} strokeWidth={isActive ? 2.5 : 2} />
      </span>

      {editingLabel ? (
        <Input
          ref={inputRef}
          value={draft}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(cat.label);
              setEditingLabel(false);
            }
          }}
          className="h-auto rounded-none border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:border-0 text-sm font-medium" containerClassName="flex-1"
        />
      ) : (
        <span className="flex-1 text-sm font-medium truncate">{cat.label}</span>
      )}

      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          onClick={() => setEditingLabel(true)}
          variant="ghost" className="w-5 h-auto"
          title="Rename"
        >
          <Pencil size={10} />
        </Button>
        <Button
          onClick={onDelete}
          variant="ghost" className="w-5 h-auto"
          title="Delete category"
        >
          <Trash2 size={10} />
        </Button>
      </div>
    </div>
  );
}

// ─── Single editable Q&A row (with role tabs) ────────────────────────────────
function FAQItemEditor({ item, onUpdate, onDelete }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  const roleAnswers = item.roleAnswers ?? {};

  // true = role uses the shared answer
  const isShared = (roleKey) => roleAnswers[roleKey] == null;

  const setRoleAnswer = (roleKey, value) =>
    onUpdate({ ...item, roleAnswers: { ...roleAnswers, [roleKey]: value } });

  const toggleShared = (roleKey) => {
    if (isShared(roleKey)) {
      // switch to custom — seed with current shared answer
      setRoleAnswer(roleKey, item.a ?? "");
    } else {
      // switch to shared — clear custom
      setRoleAnswer(roleKey, null);
    }
  };

  // count how many roles have custom answers
  const customCount = ROLES.filter((r) => !isShared(r.key)).length;

  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card group/item transition-all hover:shadow-sm">
      {/* Question row */}
      <div className="flex items-start gap-2 px-4 py-3">
        <Button
          onClick={() => setIsOpen((p) => !p)}
          variant="ghost" className="mt-0.5 shrink-0 h-auto"
        >
          {isOpen ? <ChevronDown size={15} strokeWidth={2.5} /> : <ChevronRight size={15} strokeWidth={2.5} />}
        </Button>

        <div className="flex-1">
          <AutoTextarea
            value={item.q}
            onChange={(e) => onUpdate({ ...item, q: e.target.value })}
            placeholder="Question..."
            className="w-full text-sm font-semibold text-foreground bg-transparent outline-none placeholder:text-muted-foreground/50 leading-snug"
          />
        </div>

        {/* Role customization badge */}
        {customCount > 0 && (
          <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
            {customCount} role{customCount !== 1 ? "s" : ""} custom
          </span>
        )}

        <Button
          onClick={onDelete}
          variant="ghost" className="shrink-0 w-6 opacity-0 group-hover/item:opacity-100 h-auto"
          title="Delete question"
        >
          <Trash2 size={13} />
        </Button>
      </div>

      {/* Expanded answer editor */}
      {isOpen && (
        <div className="border-t border-border/50 animate-content-in">
          {/* Role tab bar */}
          <div className="flex items-center gap-0 px-4 pt-3 pb-0 border-b border-border/40">
            {/* All Roles tab */}
            <Button
              onClick={() => setActiveTab("all")}
              variant="ghost" className={`h-auto px-3 py-1.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 -mb-px ${
                activeTab === "all"
                  ? "border-primary text-primary bg-primary/5"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              All Roles
            </Button>
            {ROLES.map((role) => {
              const custom = !isShared(role.key);
              return (
                <Button
                  key={role.key}
                  onClick={() => setActiveTab(role.key)}
                  variant="ghost" className={`h-auto relative flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-t-lg transition-all border-b-2 -mb-px ${
                    activeTab === role.key
                      ? "border-primary text-primary bg-primary/5"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {role.short}
                  {custom && (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: role.color }}
                    />
                  )}
                </Button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="px-4 pt-3 pb-4 pl-10">
            {activeTab === "all" ? (
              <>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                  Shared answer (shown to all roles without a custom answer)
                </p>
                <AutoTextarea
                  value={item.a}
                  onChange={(e) => onUpdate({ ...item, a: e.target.value })}
                  placeholder="Default answer for all roles... (use new lines for bullet lists)"
                  className="w-full text-sm text-muted-foreground bg-transparent outline-none placeholder:text-muted-foreground/40 leading-relaxed min-h-[60px]"
                />
              </>
            ) : (() => {
              const role = ROLES.find((r) => r.key === activeTab);
              const shared = isShared(activeTab);
              return (
                <>
                  {/* Share toggle */}
                  <label className="flex items-center gap-2 mb-3 cursor-pointer group/toggle">
                    <div
                      onClick={() => toggleShared(activeTab)}
                      className={`w-8 h-4 rounded-full relative transition-colors shrink-0 ${
                        shared ? "bg-muted-foreground/30" : "bg-primary"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-all ${
                          shared ? "left-0.5" : "left-4"
                        }`}
                      />
                    </div>
                    <span className="text-xs font-medium text-muted-foreground group-hover/toggle:text-foreground transition-colors">
                      {shared ? "Using shared answer" : "Custom answer for " + role.label}
                    </span>
                  </label>

                  {shared ? (
                    /* Preview of shared answer */
                    <div className="bg-muted/40 rounded-lg px-3 py-2.5 border border-border/50">
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest font-semibold mb-1">Shared preview</p>
                      <p className="text-sm text-muted-foreground/60 leading-relaxed italic">
                        {item.a || "(No shared answer written yet — edit the All Roles tab)"}
                      </p>
                    </div>
                  ) : (
                    /* Custom answer textarea */
                    <AutoTextarea
                      value={roleAnswers[activeTab] ?? ""}
                      onChange={(e) => setRoleAnswer(activeTab, e.target.value)}
                      placeholder={`Custom answer for ${role.label}...`}
                      className="w-full text-sm text-muted-foreground bg-transparent outline-none placeholder:text-muted-foreground/40 leading-relaxed min-h-[60px]"
                    />
                  )}
                </>
              );
            })()}
            <p className="text-[10px] text-muted-foreground/40 mt-2">
              Tip: Use new lines ( ↵ ) to create bullet list items in the answer.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Category color + icon picker ─────────────────────────────────────────────
function CategoryStylePicker({ cat, onChange }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        onClick={() => setOpen((p) => !p)}
        variant="outline"
        title="Change icon / color"
      >
        <span style={{ color: cat.color }}>
          {(() => {
            const Icon = ICON_MAP[cat.icon] ?? BookOpen;
            return <Icon size={13} />;
          })()}
        </span>
        <span>Style</span>
        <ChevronDown size={11} />
      </Button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 bg-card border border-border rounded-xl shadow-xl p-3 w-56 animate-slide-down">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Icon
          </p>
          <div className="grid grid-cols-4 gap-1.5 mb-3">
            {ICON_NAMES.map((name) => {
              const Icon = ICON_MAP[name];
              return (
                <Button
                  key={name}
                  onClick={() => onChange({ ...cat, icon: name })}
                  variant="ghost" className={`h-8 rounded-lg flex items-center justify-center transition-all border ${cat.icon === name ? "border-primary bg-primary/10 text-primary" : "border-transparent hover:bg-muted text-muted-foreground"}`}
                  title={name}
                >
                  <Icon size={14} />
                </Button>
              );
            })}
          </div>

          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
            Color
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_COLORS.map((c) => (
              <Button
                key={c}
                onClick={() => onChange({ ...cat, color: c })}
                style={{ backgroundColor: c }}
                variant="ghost" className={`w-6 h-6 rounded-full transition-all border-2 ${cat.color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105"}`}
              />
            ))}
          </div>

          <Button
            onClick={() => setOpen(false)}
            variant="ghost" className="mt-3 w-full h-auto justify-start"
          >
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Main FAQEditor page ───────────────────────────────────────────────────────
export default function FAQEditorPage() {
  const { user } = useAuth();
  const [categories, setCategories] = useState([]);
  const [activeCatId, setActiveCatId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load FAQ data from Supabase on mount
  useEffect(() => {
    let cancelled = false;
    loadFAQFromDB()
      .then((fresh) => {
        if (cancelled) return;
        setCategories(fresh);
        setActiveCatId(fresh[0]?.id ?? null);
      })
      .catch((err) => console.error("[FAQEditor] load error:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCat = categories.find((c) => c.id === activeCatId);

  // ── Category operations ────────────────────────────────────────────────────
  const addCategory = () => {
    const id = `cat-${generateId()}`;
    const newCat = {
      id,
      label: "New Category",
      icon: "BookOpen",
      color: CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length],
      items: [],
    };
    const updated = [...categories, newCat];
    setCategories(updated);
    setActiveCatId(id);
  };

  const deleteCategory = (id) => {
    const updated = categories.filter((c) => c.id !== id);
    setCategories(updated);
    if (activeCatId === id) setActiveCatId(updated[0]?.id ?? null);
  };

  const updateCategory = (updated) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c)),
    );
  };

  const updateCategoryLabel = (id, label) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, label } : c)),
    );
  };

  // ── Item operations ────────────────────────────────────────────────────────
  const addItem = () => {
    const newItem = { id: `item-${generateId()}`, q: "", a: "", roleAnswers: {} };
    setCategories((prev) =>
      prev.map((c) =>
        c.id === activeCatId ? { ...c, items: [...c.items, newItem] } : c,
      ),
    );
  };

  const updateItem = (itemId, updated) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === activeCatId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? updated : i)) }
          : c,
      ),
    );
  };

  const deleteItem = (itemId) => {
    setCategories((prev) =>
      prev.map((c) =>
        c.id === activeCatId
          ? { ...c, items: c.items.filter((i) => i.id !== itemId) }
          : c,
      ),
    );
  };

  // ── Persist ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      setSaving(true);
      await saveFAQToDB(categories);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      toast.error("Failed to save FAQs");
      console.error("[FAQEditor] save error:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3000);
      return;
    }
    try {
      await saveFAQToDB([]);
      setCategories([]);
      setActiveCatId(null);
    } catch (err) {
      toast.error("Failed to reset FAQs");
      console.error("[FAQEditor] reset error:", err);
    }
    setConfirmReset(false);
  };

  const totalItems = categories.reduce((acc, c) => acc + c.items.length, 0);

  if (!canEditFAQ(user)) {
    return <Navigate to="/settings" replace />;
  }

  return (
    <PageContainer maxWidth="7xl" className="pt-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="w-full gap-3">
          <PageHeader
            title="FAQ Editor"
            description={`${categories.length} categories · ${totalItems} questions`}
          >
            <div className="flex items-center gap-2 shrink-0 w-full">
              {/* Reset */}
              <Button
                onClick={handleReset}
                variant="ghost" className={`h-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  confirmReset
                    ? "border-red-300 bg-red-50 text-red-600"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <RotateCcw size={12} />
                {confirmReset ? "Confirm Reset?" : "Clear all"}
              </Button>

              {/* Save */}
              <Button
                onClick={handleSave}
                disabled={saving}
                variant="ghost" className={`h-auto flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-60 ${
                  saved
                    ? "bg-green-100 text-green-700 border border-green-300"
                    : "bg-primary text-primary-foreground hover:opacity-90"
                }`}
              >
                {saved ? (
                  <Check size={12} />
                ) : saving ? (
                  <div className="w-3 h-3 border border-primary-foreground/50 border-t-primary-foreground rounded-full animate-spin" />
                ) : (
                  <Save size={12} />
                )}
                {saved ? "Saved!" : saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </PageHeader>
        </div>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <div className="w-7 h-7 border-2 border-border border-t-primary rounded-full animate-spin mb-3" />
          <p className="text-sm">Loading FAQ content…</p>
        </div>
      ) : (
        /* Editor body */
        <div
          className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex"
          style={{ minHeight: "70vh" }}
        >
          {/* Sidebar */}
          <div className="w-56 shrink-0 border-r border-border bg-muted/10 flex flex-col overflow-hidden">
            <div className="px-3 pt-4 pb-2">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground px-1 mb-2">
                Categories
              </p>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 pb-3 space-y-0.5">
              {categories.map((cat) => (
                <CategoryItem
                  key={cat.id}
                  cat={cat}
                  isActive={cat.id === activeCatId}
                  onClick={() => setActiveCatId(cat.id)}
                  onDelete={() => deleteCategory(cat.id)}
                  onLabelChange={(label) => updateCategoryLabel(cat.id, label)}
                />
              ))}
            </div>

            {/* Add category */}
            <div className="p-3 border-t border-border">
              <Button
                onClick={addCategory}
                variant="outline" className="w-full"
              >
                <Plus size={12} />
                Add category
              </Button>
            </div>
          </div>

          {/* Main editing area */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {!activeCat ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground py-24">
                <BookOpen size={32} className="mb-3 opacity-30" />
                <p className="text-sm font-medium">
                  Select or create a category
                </p>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto px-8 py-8">
                {/* Category header */}
                <div className="flex items-start justify-between gap-4 mb-8">
                  <div className="flex items-center gap-3">
                    <span style={{ color: activeCat.color }}>
                      {(() => {
                        const Icon = ICON_MAP[activeCat.icon] ?? BookOpen;
                        return <Icon size={24} strokeWidth={1.8} />;
                      })()}
                    </span>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">
                        {activeCat.label}
                      </h2>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {activeCat.items.length} question
                        {activeCat.items.length !== 1 ? "s" : ""}
                        {" · "}
                        <span className="text-muted-foreground/60">
                          Click a question row to expand and edit its answer
                        </span>
                      </p>
                    </div>
                  </div>

                  <CategoryStylePicker
                    cat={activeCat}
                    onChange={updateCategory}
                  />
                </div>

                {/* Divider */}
                <div className="border-b border-border mb-6" />

                {/* Items */}
                <div className="space-y-2.5">
                  {activeCat.items.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground/50 text-sm border border-dashed border-border rounded-xl">
                      No questions yet. Add your first one below.
                    </div>
                  )}

                  {activeCat.items.map((item, idx) => (
                    <FAQItemEditor
                      key={item.id}
                      item={item}
                      index={idx}
                      onUpdate={(updated) => updateItem(item.id, updated)}
                      onDelete={() => deleteItem(item.id)}
                    />
                  ))}
                </div>

                {/* Add item */}
                <Button
                  onClick={addItem}
                  variant="outline" className="mt-4 w-full"
                >
                  <Plus size={15} />
                  Add question
                </Button>

                <div className="h-16" />
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
