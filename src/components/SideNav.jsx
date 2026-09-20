import {
  Plus,
  Bell,
  MessageCircle,
  LayoutList,
  UserRound,
  ListCheck,
  Bolt,
  ShieldCheck,
  Users,
  Crown,
  Target,
  X,
  ClipboardList,
  ChevronDown,
  PanelLeft,
  PanelRight,
  SquarePen,
  Megaphone,
  UsersRound,
  LayoutTemplate,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { notificationService } from "../services/notificationService";
import { activeChatService } from "../services/tasks/activeChatService";
import NotificationDrawer from "./NotificationDrawer";
import { usePushNotificationClick } from "../hooks/usePushNotificationClick";
import ComprehensiveChatModal from "./ComprehensiveChatModal";

import GlobalDetailManager from "./GlobalDetailManager";
import { Link, useNavigate, NavLink } from "react-router";
import Avatar from "./Avatar";
import { useState, useEffect } from "react";
import LogTaskModal from "./LogTaskModal";
import CreateGroupTaskModal from "../pages/group-tasks/_components/CreateGroupTaskModal";
import Dropdown from "./ui/Dropdown";
import { groupTaskService } from "../services/groupTaskService";
import { employeeService } from "../services/employeeService";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import BroadcastModal from "./BroadcastModal";
import RoleSwitcher from "./RoleSwitcher";
import { Clock } from "lucide-react";
import ApplyLeaveModal from "./offsets/ApplyLeaveModal";
import OpportunityFormModal from "./sor/OpportunityFormModal";
import { opportunityService } from "../services/opportunityService";
import {
  getFilteredNavigationGroups,
  getFilteredQuickActions,
} from "../constants/navigation";
import { useNavBadges } from "../hooks/useNavBadges";

export default function SideNav() {
  const { user } = useAuth();
  const navigate = useNavigate();
  usePushNotificationClick(user, navigate);
  const badges = useNavBadges(user);

  const handleQuickAction = (actionId) => {
    setIsMobileOpen(false);
    if (actionId === "task") setIsLogTaskOpen(true);
    else if (actionId === "group-task") setIsCreateGroupOpen(true);
    else if (actionId === "offset") setIsApplyOffsetOpen(true);
    else if (actionId === "sor") setIsOpportunityOpen(true);
  };

  // Mobile Toggle State
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isLogTaskOpen, setIsLogTaskOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [isApplyOffsetOpen, setIsApplyOffsetOpen] = useState(false);
  const [isOpportunityOpen, setIsOpportunityOpen] = useState(false);

  const getInitialExpandedState = (userId) => {
    const defaults = {
      workspace: true,
      operations: true,
      sales: true,
      approvals: true,
      human_resources: false,
      administration: false,
    };

    if (!userId) return defaults;

    try {
      const saved = localStorage.getItem(`erp_sidebar_groups_${userId}`);
      if (saved) {
        return { ...defaults, ...JSON.parse(saved) };
      }
    } catch {
      // Ignore storage errors
    }
    return defaults;
  };

  // Accordion State with localStorage persistence
  const [expandedGroups, setExpandedGroups] = useState(() =>
    getInitialExpandedState(user?.id)
  );

  useEffect(() => {
    if (user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedGroups(getInitialExpandedState(user.id));
    }
  }, [user?.id]);

  const toggleGroup = (groupKey) => {
    setExpandedGroups((prev) => {
      const next = { ...prev, [groupKey]: !prev[groupKey] };
      if (user?.id) {
        try {
          localStorage.setItem(
            `erp_sidebar_groups_${user.id}`,
            JSON.stringify(next)
          );
        } catch {
          // Ignore storage errors
        }
      }
      return next;
    });
  };

  // Issue #206: the sidebar collapses to an icon rail app-wide, remembered
  // per person beside the group accordion state above. Mobile ignores this —
  // its drawer is a full overlay, not a rail — so the toggle only renders and
  // only changes layout at the md breakpoint.
  const getInitialCollapsed = (userId) => {
    if (!userId) return false;
    try {
      return localStorage.getItem(`erp_sidebar_collapsed_${userId}`) === "1";
    } catch {
      return false;
    }
  };
  const [isCollapsed, setIsCollapsed] = useState(() => getInitialCollapsed(user?.id));

  useEffect(() => {
    if (user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsCollapsed(getInitialCollapsed(user.id));
    }
  }, [user?.id]);

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      if (user?.id) {
        try {
          localStorage.setItem(`erp_sidebar_collapsed_${user.id}`, next ? "1" : "0");
        } catch {
          // Ignore storage errors
        }
      }
      return next;
    });
  };

  // Notification State
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications", user?.id],
    queryFn: () => notificationService.getMyNotifications(user?.id),
    enabled: !!user?.id,
  });
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Active Chats State
  const [isChatsOpen, setIsChatsOpen] = useState(false);
  const { data: activeChats = [] } = useQuery({
    queryKey: ["activeChats", user?.id],
    queryFn: () => activeChatService.getActiveChats(user?.id),
    enabled: !!user?.id,
  });
  const unreadChatsCount = activeChats.filter((c) => c.is_unread).length;

  const queryClient = useQueryClient();

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: !!user?.id,
  });

  const createGroupMutation = useMutation({
    mutationFn: (payload) => groupTaskService.createGroupTask(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Group Task created!");
      setIsCreateGroupOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const createOpportunityMutation = useMutation({
    mutationFn: (payload) => opportunityService.createOpportunity(payload, user?.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast.success("Opportunity Registered!");
      setIsOpportunityOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  // Get domain-driven filtered groups and quick actions from declarative registry
  const activeGroups = getFilteredNavigationGroups(user);
  const quickActionGroups = getFilteredQuickActions(user);

  // React Select setup for Profile Dropdown
  const profileOptions = [
    { value: "profile", label: "Profile" },
    { value: "settings", label: "Settings" },
  ];

  const handleProfileSelect = (selected) => {
    if (selected) {
      navigate(`/${selected.value}`);
      setIsMobileOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Drawer Trigger (PanelRight) */}
      <div className="md:hidden fixed top-3 left-3 z-40">
        <button
          onClick={() => setIsMobileOpen(true)}
          className="text-sidebar-foreground/80 hover:text-sidebar-foreground bg-sidebar border-r border-sidebar-border backdrop-blur-md border p-1.5 rounded-lg shadow-sm transition-colors"
        >
          <PanelRight size={18} strokeWidth={2} />
        </button>
      </div>

      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-40 md:hidden transition-opacity"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Merged Single-Pane Sidebar Container */}
      <aside
        className={`
          ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
          fixed md:sticky top-0 left-0 h-screen z-50 flex flex-col
          bg-sidebar   text-sm font-sans
          transition-[transform,width] duration-300 ease-in-out
          w-[240px] ${isCollapsed ? "md:w-[68px]" : "md:w-[240px]"} shrink-0 overflow-y-auto scrollbar-hide
        `}
      >
        {/* Mobile Close Action (PanelLeft) */}
        <div className="md:hidden absolute top-4 right-4 z-50">
          <button
            onClick={() => setIsMobileOpen(false)}
            className="text-sidebar-foreground/60 hover:text-sidebar-foreground p-1 bg-sidebar border-r border-sidebar-border rounded-md shadow-sm border border-sidebar-border"
          >
            <PanelLeft size={18} strokeWidth={2} />
          </button>
        </div>

        {/* Desktop collapse toggle — a rail is icons-only, so this is the one
            control that survives collapsing to it. */}
        <button
          onClick={toggleCollapsed}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="hidden md:flex absolute top-4 right-2 z-50 items-center justify-center h-6 w-6 rounded-full border border-sidebar-border bg-sidebar text-sidebar-foreground/70 shadow-sm hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        >
          {isCollapsed ? <PanelRight size={13} strokeWidth={2} /> : <PanelLeft size={13} strokeWidth={2} />}
        </button>

        {/* 1. Header (Profile Dropdown + Quick Actions) */}
        <div className="px-3 pt-6 pb-2 flex flex-col gap-2.5">
          {/* Row 1: Profile Selector */}
          <div className="flex-1 min-w-0">
            <Dropdown
              className="flex-1 min-w-0"
              trigger={({ isOpen }) => (
                <div
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all ${isCollapsed ? "md:justify-center md:px-0" : "justify-between"} ${isOpen ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                    }`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden w-full group cursor-pointer transition-opacity">
                    <Avatar
                      src={user?.picture}
                      name={user?.name || "U"}
                      size="md"
                      className="rounded-md shadow-sm shrink-0"
                    />
                    <span className={`font-semibold text-[14px] truncate text-sidebar-foreground tracking-wide mt-[0.5px] ${isCollapsed ? "md:hidden" : ""}`}>
                      {user?.name || "User"}
                    </span>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-sidebar-foreground/60 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180" : ""} ${isCollapsed ? "md:hidden" : ""}`}
                  />
                </div>
              )}
            >
              {({ close }) => (
                <div className="p-1.5 min-w-[215px] flex flex-col gap-0.5 bg-muted rounded-xl ">
                  {profileOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        handleProfileSelect(option);
                        close();
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-foreground text-sm font-semibold hover:bg-sidebar-accent transition-colors text-left"
                    >
                      <span>{option.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
          </div>

          {/* Row 2: Action Buttons — stacks vertically on the collapsed rail,
              where there isn't width for four icons side by side. */}
          <div className={`flex items-center gap-1.5 ${isCollapsed ? "md:flex-col" : ""}`}>
            {/* Broadcast — super admins only */}
            {user?.isSuperAdmin && (
              <button
                onClick={() => {
                  setIsMobileOpen(false);
                  setIsBroadcastOpen(true);
                }}
                className={`flex items-center justify-center p-2 rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent transition-all ${isCollapsed ? "md:w-full" : ""}`}
                title="Broadcast"
              >
                <Megaphone size={15} strokeWidth={2.2} />
              </button>
            )}

            {/* Notifications */}
            <button
              onClick={() => {
                setIsNotifOpen(true);
                setIsMobileOpen(false);
              }}
              className={`relative flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${isCollapsed ? "md:w-full md:flex-none" : ""} ${isNotifOpen ? "bg-sidebar-accent text-sidebar-primary border-sidebar-primary/30 shadow-sm" : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent"}`}
              title="Notifications"
            >
              <Bell size={15} strokeWidth={2.2} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm ring-2 ring-sidebar">
                  {unreadCount}
                </span>
              )}
            </button>

            {/* Chats */}
            <button
              onClick={() => {
                setIsChatsOpen(true);
                setIsMobileOpen(false);
              }}
              className={`relative flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${isCollapsed ? "md:w-full md:flex-none" : ""} ${isChatsOpen ? "bg-sidebar-accent text-sidebar-primary border-sidebar-primary/30 shadow-sm" : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent"}`}
              title="Chats"
            >
              <MessageCircle size={15} strokeWidth={2.2} />
              {unreadChatsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm ring-2 ring-sidebar">
                  {unreadChatsCount}
                </span>
              )}
            </button>

            {/* Quick Action (+) Button */}
            {quickActionGroups.length > 0 && (
              <Dropdown
                placement="bottom-end"
                className={isCollapsed ? "md:w-full" : "flex-1"}
                usePortal={true}
                trigger={({ isOpen }) => (
                  <button
                    className={`w-full relative flex-1 flex items-center justify-center py-2 px-3 rounded-lg border transition-all ${
                      isOpen
                        ? "bg-sidebar-accent text-sidebar-primary border-sidebar-primary/10 shadow-sm"
                        : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent"
                    }`}
                    title="Create new..."
                  >
                    <Plus size={15} strokeWidth={2.5} />
                  </button>
                )}
              >
                {({ close }) => (
                  <div className="p-1.5 min-w-[190px] flex flex-col gap-1.5 bg-mauve-3 rounded-xl shadow-lg border border-border">
                    {quickActionGroups.map((catGroup, groupIdx) => (
                      <div key={catGroup.category} className="flex flex-col gap-0.5">
                        {groupIdx > 0 && (
                          <div className="h-[1px] bg-border/60 my-1 -mx-0.5" />
                        )}
                        <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          {catGroup.category}
                        </span>
                        {catGroup.items.map((item) => {
                          const Icon = item.icon;
                          return (
                            <button
                              key={item.id}
                              onClick={() => {
                                close();
                                handleQuickAction(item.id);
                              }}
                              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                            >
                              <Icon size={14} className="text-sidebar-foreground/70" />
                              <span>{item.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </Dropdown>
            )}
          </div>
        </div>

        {/* 4. Combined Workspace Menus */}
        <div className="px-3 flex-1 flex flex-col text-sidebar-foreground/80 pb-4">
          <nav className="flex flex-col gap-5 mb-6 mt-2">
            {activeGroups.map((group) => {
              const key = group.key;
              const isExpanded = expandedGroups[key] ?? group.defaultExpanded ?? true;
              // A collapsed rail has no room for a header or an accordion —
              // every group just shows its icons, ignoring the per-group
              // expand/collapse state (which resumes as soon as it's expanded).
              const showLinks = isCollapsed || isExpanded;
              const groupBadgeCount = group.links.reduce((acc, l) => {
                return acc + (l.badgeKey && badges?.[l.badgeKey] ? badges[l.badgeKey] : 0);
              }, 0);

              return (
                <div key={key} className="flex flex-col">
                  <div
                    onClick={() => toggleGroup(key)}
                    className={`px-3 mb-1.5 flex items-center justify-between text-sidebar-foreground/60 group/header cursor-pointer transition-colors hover:text-sidebar-foreground ${isCollapsed ? "md:hidden" : ""}`}
                  >
                    <span className="text-[11px] font-black tracking-widest uppercase">
                      {group.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {!isExpanded && groupBadgeCount > 0 && (
                        <span
                          data-testid={`group-badge-${key}`}
                          className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm"
                        >
                          {groupBadgeCount}
                        </span>
                      )}
                      <ChevronDown
                        size={14}
                        className={`transition-transform duration-200 ${isExpanded ? "rotate-180" : ""
                          }`}
                      />
                    </div>
                  </div>
                  <div
                    className={`flex flex-col gap-1 overflow-hidden transition-all duration-300 ${showLinks ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                      }`}
                  >
                    {group.links.map((navLink) => {
                      const Icon = navLink.icon;
                      const linkBadge = navLink.badgeKey ? badges?.[navLink.badgeKey] || 0 : 0;

                      return (
                        <NavLink
                          key={navLink.label}
                          to={navLink.link}
                          end={!!navLink.exactMatch}
                          onClick={() => setIsMobileOpen(false)}
                          title={isCollapsed ? navLink.label : undefined}
                          className={({ isActive }) =>
                            `flex gap-3 items-center px-3 py-2 rounded-md transition-colors ${isCollapsed ? "md:justify-center md:px-2" : ""} ${isActive
                              ? "bg-sidebar-accent text-sidebar-primary shadow-sm"
                              : "hover:text-sidebar-foreground hover:bg-sidebar-accent/50 text-sidebar-foreground/80"
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <Icon
                                size={15}
                                strokeWidth={2.2}
                                className={`shrink-0 transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground/60"
                                  }`}
                              />
                              <span
                                className={`truncate text-[13.5px] mt-[0.5px] transition-all flex-1 ${isCollapsed ? "md:hidden" : ""} ${isActive ? "font-bold text-sidebar-primary" : "font-medium"
                                  }`}
                              >
                                {navLink.label}
                              </span>
                              {linkBadge > 0 && (
                                <span
                                  data-testid={`link-badge-${navLink.label}`}
                                  className={`shrink-0 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sidebar-primary/15 text-sidebar-primary px-1.5 text-[10px] font-bold ${isCollapsed ? "md:hidden" : ""}`}
                                >
                                  {linkBadge}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className={isCollapsed ? "md:hidden" : ""}>
            <RoleSwitcher />
          </div>
        </div>
      </aside>

      {/* Drawers */}
      <NotificationDrawer
        isOpen={isNotifOpen}
        onClose={() => setIsNotifOpen(false)}
      />
      <ComprehensiveChatModal
        isOpen={isChatsOpen}
        onClose={() => setIsChatsOpen(false)}
      />
      <GlobalDetailManager />
      <BroadcastModal
        isOpen={isBroadcastOpen}
        onClose={() => setIsBroadcastOpen(false)}
      />
      <LogTaskModal
        isOpen={isLogTaskOpen}
        onClose={() => setIsLogTaskOpen(false)}
      />
      <CreateGroupTaskModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        user={user}
        employees={employees}
        onSubmit={(payload) => createGroupMutation.mutateAsync(payload)}
        isSubmitting={createGroupMutation.isPending}
      />
      <ApplyLeaveModal
        isOpen={isApplyOffsetOpen}
        onClose={() => setIsApplyOffsetOpen(false)}
        onSuccess={() => {
          // You could optionally refetch globally here, or let the local pages handle their own refetch on mount/focus.
        }}
      />
      <OpportunityFormModal
        isOpen={isOpportunityOpen}
        onClose={() => setIsOpportunityOpen(false)}
        onSubmit={(payload) => createOpportunityMutation.mutate(payload)}
        isPending={createOpportunityMutation.isPending}
      />
    </>
  );
}
