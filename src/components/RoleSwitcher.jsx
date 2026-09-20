import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { FlaskConical, ChevronUp } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import toast from "react-hot-toast";
import Select from "react-select";
import { defaultSelectStyles } from "../styles/selectStyles";
import { getPermissionContext } from "../utils/permissions";
import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";

// Custom sleek toggle switch
const Toggle = ({ checked, onChange }) => (
  <Button
    type="button"
    onClick={() => onChange(!checked)}
    variant="ghost" className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
      checked ? "bg-mauve-12" : "bg-mauve-4"
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-card shadow ring-0 transition duration-200 ease-in-out ${
        checked ? "translate-x-4" : "translate-x-0"
      }`}
    />
  </Button>
);

export default function RoleSwitcher() {
  const { user } = useAuth();
  const { isRoleSimulator, isHead, isHr, isSuperAdmin } = getPermissionContext(user);
  const [isOpen, setIsOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [, setIsMounted] = useState(false);
  const [deptSubDeptPairs, setDeptSubDeptPairs] = useState([]);
  const [loadingData, setLoadingData] = useState(true);

  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);

  const updateCoords = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({
      left: rect.left,
      bottom: window.innerHeight - rect.top + 12,
      width: Math.max(rect.width, 260),
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      updateCoords();
      window.addEventListener("resize", updateCoords);
      const handleScroll = (e) => {
        if (e.target?.closest && e.target.closest(".role-switcher-popover")) return;
        updateCoords();
      };
      window.addEventListener("scroll", handleScroll, true);
      return () => {
        window.removeEventListener("resize", updateCoords);
        window.removeEventListener("scroll", handleScroll, true);
      };
    }
  }, [isOpen, updateCoords]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!isOpen || switching) return;
      if (triggerRef.current && triggerRef.current.contains(event.target)) return;
      if (popoverRef.current && popoverRef.current.contains(event.target)) return;
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [isOpen, switching]);

  // Form state
  const [formState, setFormState] = useState({
    department: "OPERATIONS",
    sub_department: "ALL",
    is_head: false,
    is_hr: false,
    is_super_admin: false,
  });

  useEffect(() => {
    setIsMounted(true);
    fetchDeptData();
  }, []);

  const fetchDeptData = async () => {
    try {
      // Fetch from BOTH categories and employees to capture all dept/sub_dept combos
      const [catResult, empResult] = await Promise.all([
        supabase
          .from("categories")
          .select("department, sub_department")
          .order("department"),
        supabase
          .from("employees")
          .select("department, sub_department")
          .neq("is_deleted", true)
          .order("department"),
      ]);

      const catData = catResult.data || [];
      const empData = empResult.data || [];

      // Merge and deduplicate
      const seen = new Set();
      const merged = [];
      [...catData, ...empData].forEach((row) => {
        const dept = row.department?.trim();
        const subDept = row.sub_department?.trim();
        if (!dept) return;
        const key = `${dept}::${subDept || ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          merged.push({ department: dept, sub_department: subDept || null });
        }
      });

      setDeptSubDeptPairs(merged);
    } catch (err) {
      console.error("Failed to fetch dept data for RoleSwitcher:", err);
    } finally {
      setLoadingData(false);
    }
  };

  // Sync form state when opened or user object changes
  useEffect(() => {
    if (isOpen && user) {
      setFormState({
        department: user.department || "OPERATIONS",
        sub_department: user.sub_department || "ALL",
        is_head: isHead,
        is_hr: isHr,
        is_super_admin: isSuperAdmin,
      });
    }
  }, [isOpen, user, isHead, isHr, isSuperAdmin]);

  if (!user || !isRoleSimulator) return null;

  // ── Derived Options ────────────────────────────────────────
  const uniqueDepts = [
    ...new Set(
      deptSubDeptPairs
        .map((c) => c.department)
        .filter(Boolean)
        .filter((d) => d !== "ALL"),
    ),
  ].sort();
  const deptOptions = uniqueDepts.map((d) => ({ value: d, label: d }));

  const filteredSubDepts = [
    ...new Set(
      deptSubDeptPairs
        .filter((c) => c.department === formState.department)
        .map((c) => c.sub_department)
        .filter(Boolean)
        .filter((s) => s !== "ALL"),
    ),
  ].sort();

  const subDeptOptions = [
    { value: "ALL", label: "NULL / Dept-Wide" },
    ...filteredSubDepts.map((s) => ({ value: s, label: s })),
  ];

  const handleApply = async (configOverride) => {
    const config = configOverride || formState;
    setSwitching(true);
    try {
      const dbValues = {
        department: config.department,
        sub_department:
          config.sub_department === "ALL" ? null : config.sub_department,
        is_head: config.is_head,
        is_hr: config.is_hr,
        is_super_admin: config.is_super_admin,
      };

      const { error } = await supabase
        .from("employees")
        .update(dbValues)
        .eq("email", user.email);

      if (error) throw error;

      toast.success("Simulation applied", {
        style: { background: "#111827", color: "#fff", fontSize: "13px" },
      });
      setTimeout(() => window.location.reload(), 300);
    } catch (err) {
      console.error("Role switch failed:", err);
      toast.error("Failed to apply configuration");
      setSwitching(false);
    }
  };

  const handleReset = () => {
    const adminConfig = {
      department: "SUPER ADMIN",
      sub_department: "ALL",
      is_head: true,
      is_hr: true,
      is_super_admin: true,
    };
    setFormState(adminConfig);
    handleApply(adminConfig);
  };

  const currentStatusText = () => {
    if (isSuperAdmin) return "Testing: Super Admin";
    const d =
      user.department === "OPERATIONS" ? "OPS" : user.department || "N/A";
    const s = user.sub_department || "ALL";
    const h = isHead ? " (Head)" : "";
    return `Simulating: ${d} / ${s}${h}`;
  };

  return (
    <div className="w-full relative z-100 mt-auto">
      {isOpen &&
        coords &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              left: `${coords.left}px`,
              bottom: `${coords.bottom}px`,
              width: "260px",
              zIndex: 100002,
            }}
            className="role-switcher-popover bg-card border border-border rounded-xl shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-300 overflow-visible"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 bg-card border-b border-mauve-3 rounded-t-xl">
              <div className="flex items-center gap-2">
                <FlaskConical size={14} className="text-foreground" />
                <h3 className="text-[11px] font-bold text-foreground uppercase tracking-widest">
                  Role Simulator
                </h3>
              </div>
              <Button
                onClick={handleReset}
                variant="outline"
              >
                Reset
              </Button>
            </div>

            <div className="p-5 space-y-6">
              {/* Field Sets */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <FieldBox bare label="Department">
<div className="relative">
                    <Select
                      instanceId="role-switcher-dept"
                      options={deptOptions}
                      value={
                        deptOptions.find(
                          (o) => o.value === formState.department,
                        ) || deptOptions[0]
                      }
                      onChange={(opt) => {
                        setFormState({
                          ...formState,
                          department: opt.value,
                          sub_department: "ALL",
                        });
                      }}
                      styles={defaultSelectStyles}
                      isSearchable={false}
                      menuPlacement="auto"
                      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                      isLoading={loadingData}
                    />
                  </div>
</FieldBox>
                </div>
                <div className="space-y-1.5">
                  <FieldBox bare label="Sub-Department">
<div className="relative">
                    <Select
                      instanceId="role-switcher-subdept"
                      options={subDeptOptions}
                      value={
                        subDeptOptions.find(
                          (o) => o.value === (formState.sub_department || "ALL"),
                        ) || subDeptOptions[0]
                      }
                      onChange={(opt) =>
                        setFormState({ ...formState, sub_department: opt.value })
                      }
                      styles={defaultSelectStyles}
                      isSearchable={true}
                      menuPlacement="auto"
                      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                      placeholder="Select Sub-Dept"
                      isLoading={loadingData}
                    />
                  </div>
</FieldBox>
                </div>
              </div>

              <div className="h-px bg-mauve-2" />

              {/* Toggles */}
              <div className="space-y-4">
                {[
                  {
                    id: "is_head",
                    label: "is_head",
                    desc: "Grants approval authority",
                  },
                  {
                    id: "is_hr",
                    label: "is_hr",
                    desc: "Access to HR management tools",
                  },
                  {
                    id: "is_super_admin",
                    label: "is_super_admin",
                    desc: "Full root-level system access",
                  },
                ].map((flag) => (
                  <div
                    key={`toggle-${flag.id}`}
                    className="flex items-center justify-between group px-1"
                  >
                    <div>
                      <p className="text-[13px] text-foreground font-bold leading-tight group-hover:text-black">
                        {flag.label}
                      </p>
                      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                        {flag.desc}
                      </p>
                    </div>
                    <Toggle
                      checked={formState[flag.id]}
                      onChange={(v) =>
                        setFormState({ ...formState, [flag.id]: v })
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Action */}
              <Button
                onClick={() => handleApply()}
                disabled={switching}
                variant="ghost" className="w-full h-auto justify-start"
              >
                {switching ? (
                  <Spinner size="sm" />
                ) : (
                  <>
                    <FlaskConical size={16} />
                    <span>Update Configuration</span>
                  </>
                )}
              </Button>
            </div>
          </div>,
          document.body
        )}

      {/* Trigger */}
      <Button
        ref={triggerRef}
        onClick={() => {
          if (!isOpen) {
            updateCoords();
          }
          setIsOpen(!isOpen);
        }}
        disabled={switching}
        variant="ghost" className="w-full h-auto justify-start"
      >
        <div
          className={`p-1.5 rounded-md bg-card/10 group-hover:bg-card/20 transition-colors`}
        >
          <FlaskConical size={14} className="text-primary-foreground" />
        </div>
        <span className="text-[11px] font-bold tracking-wider uppercase text-left flex-1 truncate">
          {currentStatusText()}
        </span>
        <div
          className={`transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
        >
          <ChevronUp size={14} className="opacity-40" />
        </div>
      </Button>
    </div>
  );
}
