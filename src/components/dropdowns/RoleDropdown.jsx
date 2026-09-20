import React, { useState, useMemo } from "react";
import Dropdown from "../ui/Dropdown";
import { UserCog, Search, Check, Settings2, X } from "lucide-react";
import { FilterTrigger } from "../ui/FilterDropdown";
import { Button } from "@/components/ui/button";

/**
 * RoleDropdown — picks a group task member's role from the DB-backed
 * `committee_roles` list.
 *
 * Replaces the wrapped row of role chips, which rendered every role at once and
 * squeezed the member card. The list is user-managed and already past a dozen
 * entries, so it gets a search box like CategoryDropdown rather than the plain
 * list PriorityDropdown uses.
 *
 * Role is optional, hence the explicit "No role" entry — without it a role
 * picked by mistake could not be taken back.
 */
export default function RoleDropdown({
  value,
  onChange,
  roles = [],
  isLoading = false,
  disabled = false,
  className = "",
  usePortal = false,
  onManage,
  onClose,
}) {
  const [search, setSearch] = useState("");

  const searchedRoles = useMemo(() => {
    if (!search.trim()) return roles;
    const q = search.trim().toLowerCase();
    return roles.filter((r) => r.role_name?.toLowerCase().includes(q));
  }, [roles, search]);

  return (
    <Dropdown
      disabled={disabled}
      usePortal={usePortal}
      onClose={onClose}
      className={className}
      trigger={({ isOpen, disabled }) => (
        <FilterTrigger
          label={value || "No role"}
          isActive={!!value}
          isOpen={isOpen}
          icon={UserCog}
          disabled={disabled}
        />
      )}
    >
      {({ close }) => (
        <div className="flex flex-col min-h-0 max-h-[inherit] overflow-hidden">
          {roles.length > 5 && (
            <div className="px-2 pt-2 pb-1 border-b border-border shrink-0">
              <div className="flex items-center gap-2 px-2.5 py-1.5 bg-muted/50 rounded-md border border-border focus-within:border-mauve-4 focus-within:ring-1 focus-within:ring-mauve-4 transition-all">
                <Search size={14} className="text-muted-foreground shrink-0" />
                <input
                  type="text"
                  placeholder="Search roles..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 bg-transparent outline-none text-[13px] font-medium text-foreground placeholder:text-muted-foreground"
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}

          <div className="max-h-[220px] flex-1 min-h-0 overflow-y-auto p-1 custom-scrollbar">
            {isLoading ? (
              <p className="text-[13px] text-mauve-7 text-center py-4 font-medium">
                Loading…
              </p>
            ) : (
              <>
                <Button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange("");
                    close();
                  }}
                  variant="ghost" className={`h-auto w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold transition-all active:scale-95 cursor-pointer flex items-center gap-2 ${!value
                    ? "bg-muted/80 text-foreground font-bold"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                >
                  <X size={13} className="shrink-0 opacity-60" />
                  <span className="truncate flex-1">No role</span>
                  {!value && (
                    <Check size={14} className="text-muted-foreground/80 shrink-0" />
                  )}
                </Button>

                {searchedRoles.length === 0 ? (
                  <p className="text-[13px] text-mauve-7 text-center py-4 font-medium">
                    No roles found
                  </p>
                ) : (
                  searchedRoles.map((r) => (
                    <Button
                      key={r.id ?? r.role_name}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange(r.role_name);
                        close();
                      }}
                      variant="ghost" className={`h-auto w-full text-left px-3 py-2 rounded-lg text-[13px] font-semibold transition-all active:scale-95 cursor-pointer flex items-center gap-2 ${value === r.role_name
                        ? "bg-muted/80 text-foreground font-bold"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                    >
                      <span className="truncate flex-1">{r.role_name}</span>
                      {value === r.role_name && (
                        <Check
                          size={14}
                          className="text-muted-foreground/80 shrink-0"
                        />
                      )}
                    </Button>
                  ))
                )}
              </>
            )}
          </div>

          {onManage && (
            <div className="border-t border-border p-1 shrink-0 bg-muted/40">
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                  onManage();
                }}
                variant="ghost" className="w-full h-auto justify-start"
              >
                <Settings2 size={13} className="shrink-0" />
                Manage roles
              </Button>
            </div>
          )}
        </div>
      )}
    </Dropdown>
  );
}
