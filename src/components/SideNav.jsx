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
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { notificationService } from "../services/notificationService";
import { activeChatService } from "../services/tasks/activeChatService";
import NotificationDrawer from "./NotificationDrawer";
import ComprehensiveChatModal from "./ComprehensiveChatModal";

import GlobalDetailManager from "./GlobalDetailManager";
import { Link, useNavigate, NavLink } from "react-router";
import Avatar from "./Avatar";
import { useState } from "react";
import LogTaskModal from "./LogTaskModal";
import CreateGroupTaskModal from "../pages/group-tasks/components/CreateGroupTaskModal";
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

export default function SideNav() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Mobile Toggle State
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isLogTaskOpen, setIsLogTaskOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [isBroadcastOpen, setIsBroadcastOpen] = useState(false);
  const [isApplyOffsetOpen, setIsApplyOffsetOpen] = useState(false);
  const [isOpportunityOpen, setIsOpportunityOpen] = useState(false);

  // Accordion State
  const [expandedGroups, setExpandedGroups] = useState({
    main: true,
    approvals: true,
    opportunities: true,
    management: true,
  });

  const toggleGroup = (groupKey) => {
    setExpandedGroups((prev) => ({ ...prev, [groupKey]: !prev[groupKey] }));
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

  const isSuperAdmin =
    user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const canManage = isHead || isSuperAdmin;

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: !!user?.id && canManage,
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

  const hasSales = user?.has_sales_flow;
  const hasTask = user?.has_task_flow;

  // Nav mapping logic grouped by categories
  let groups = {
    main: { label: "Main", links: [] },
    approvals: { label: "Approvals", links: [] },
    opportunities: { label: "Sales Opportunities", links: [] },
    management: { label: "Management", links: [] },
  };

  if (user?.isSuperAdmin) {
    groups.main.links = [
      { label: "Dashboard", link: "/", icon: LayoutList },
      { label: "Tasks", link: "/tasks", icon: ListCheck },
      { label: "Group Tasks", link: "/group-tasks", icon: UsersRound },
      { label: "Leaves & Overtime", link: "/offsets", icon: Clock },
    ];
    groups.approvals.links = [
      { label: "Task Approval", link: "/approvals/tasks", icon: ShieldCheck },
      {
        label: "Task Verification",
        link: "/approvals/hr-verification",
        icon: ShieldCheck,
      },
    ];
    groups.opportunities.links = [
      { label: "Opportunity Registration", link: "/opportunities", icon: Target },
    ];
    groups.management.links = [
      { label: "HR Management", link: "/hr/management", icon: Users },
      { label: "HR Leaves Manager", link: "/hr/offsets", icon: Clock },
      { label: "Super Admin", link: "/super-admin", icon: Crown },
      {
        label: "Activity Log",
        link: "/super-admin/activity-log",
        icon: ClipboardList,
      },
    ];
  } else {
    groups.main.links.push({ label: "Dashboard", link: "/", icon: LayoutList });
    groups.main.links.push({ label: "Leaves & Overtime", link: "/offsets", icon: Clock });

    if (hasTask) {
      groups.main.links.push(
        { label: "Tasks", link: "/tasks", icon: ListCheck },
        { label: "Group Tasks", link: "/group-tasks", icon: UsersRound },
      );
    }

    if (hasSales) {
      groups.opportunities.links.push({
        label: "Opportunity Registration",
        link: "/opportunities",
        icon: Target,
      });
    }

    if (user?.isHead || user?.is_head) {
      const userSubDept = user?.subDepartment || user?.sub_department;
      const isMasterHead = !userSubDept;

      if (isMasterHead || hasTask) {
        groups.approvals.links.push({
          label: "Task Approval",
          link: "/approvals/tasks",
          icon: ShieldCheck,
        });
      }
    }

    if (user?.isHr) {
      groups.approvals.links.push({
        label: "Task Verification",
        link: "/approvals/hr-verification",
        icon: ShieldCheck,
      });
      groups.management.links.push({
        label: "HR Management",
        link: "/hr/management",
        icon: Users,
      });
      groups.management.links.push({
        label: "HR Leaves Manager",
        link: "/hr/offsets",
        icon: Clock,
      });
      groups.management.links.push({
        label: "Activity Log",
        link: "/super-admin/activity-log",
        icon: ClipboardList,
      });
      if (!hasSales) {
        groups.opportunities.links.push({
          label: "Opportunity Registration",
          link: "/opportunities",
          icon: Target,
        });
      }
    }
  }

  const activeGroups = Object.entries(groups).filter(
    ([, group]) => group.links.length > 0
  );

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
          transition-transform duration-300 ease-in-out
          w-[240px] shrink-0 overflow-y-auto scrollbar-hide
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

        {/* 1. Header (Profile Dropdown + Quick Actions) */}
        <div className="px-3 pt-6 pb-2 flex flex-col gap-2.5">
          {/* Row 1: Profile Selector */}
          <div className="flex-1 min-w-0">
            <Dropdown
              className="flex-1 min-w-0"
              trigger={({ isOpen }) => (
                <div
                  className={`flex items-center justify-between gap-2.5 px-3 py-2 rounded-lg transition-all ${isOpen ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50"
                    }`}
                >
                  <div className="flex items-center gap-2.5 overflow-hidden w-full group cursor-pointer transition-opacity">
                    <Avatar
                      src={user?.picture}
                      name={user?.name || "U"}
                      size="md"
                      className="rounded-md shadow-sm"
                    />
                    <span className="font-semibold text-[14px] truncate text-sidebar-foreground tracking-wide mt-[0.5px]">
                      {user?.name || "User"}
                    </span>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`text-sidebar-foreground/60 transition-transform duration-200 ${isOpen ? "rotate-180" : ""
                      }`}
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

          {/* Row 2: Action Buttons */}
          <div className="flex items-center gap-1.5">
            {/* Broadcast — super admins only */}
            {user?.isSuperAdmin && (
              <button
                onClick={() => {
                  setIsMobileOpen(false);
                  setIsBroadcastOpen(true);
                }}
                className="flex items-center justify-center p-2 rounded-lg border border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent transition-all"
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
              className={`relative flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${isNotifOpen ? "bg-sidebar-accent text-sidebar-primary border-sidebar-primary/30 shadow-sm" : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent"}`}
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
              className={`relative flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${isChatsOpen ? "bg-sidebar-accent text-sidebar-primary border-sidebar-primary/30 shadow-sm" : "border-sidebar-border bg-sidebar-accent text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 hover:border-sidebar-accent"}`}
              title="Chats"
            >
              <MessageCircle size={15} strokeWidth={2.2} />
              {unreadChatsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sidebar-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm ring-2 ring-sidebar">
                  {unreadChatsCount}
                </span>
              )}
            </button>

            {/* Merged Action Button */}
            {canManage ? (
              <Dropdown
                placement="bottom-end"
                className="flex-1"
                usePortal={true}
                trigger={({ isOpen }) => (
                  <button
                    className={`w-full relative flex-1 flex items-center justify-center py-2 px-3 rounded-lg border transition-all ${isOpen
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
                  <div className="p-1.5 min-w-[180px] flex flex-col gap-0.5 bg-mauve-3  rounded-xl">
                    <button
                      onClick={() => {
                        close();
                        setIsMobileOpen(false);
                        setIsLogTaskOpen(true);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                    >
                      <SquarePen size={14} />
                      <span>Task</span>
                    </button>
                    <button
                      onClick={() => {
                        close();
                        setIsMobileOpen(false);
                        setIsCreateGroupOpen(true);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                    >
                      <UsersRound size={14} />
                      <span>Group Task</span>
                    </button>
                    <button
                      onClick={() => {
                        close();
                        setIsMobileOpen(false);
                        setIsApplyOffsetOpen(true);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                    >
                      <Clock size={14} />
                      <span>Offset / Overtime</span>
                    </button>
                    {(hasSales || user?.isSuperAdmin || user?.isHr) && (
                      <button
                        onClick={() => {
                          close();
                          setIsMobileOpen(false);
                          setIsOpportunityOpen(true);
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                      >
                        <Target size={14} />
                        <span>SOR</span>
                      </button>
                    )}
                  </div>
                )}
              </Dropdown>
            ) : (
              <Dropdown
                placement="bottom-end"
                className="flex-1"
                usePortal={true}
                trigger={({ isOpen }) => (
                  <button
                    className={`w-full flex-1 flex items-center justify-center p-2 rounded-lg border transition-all ${isOpen
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
                  <div className="p-1.5 min-w-[180px] flex flex-col gap-0.5 bg-mauve-3 rounded-xl">
                    <button
                      onClick={() => {
                        close();
                        setIsMobileOpen(false);
                        setIsLogTaskOpen(true);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                    >
                      <SquarePen size={14} />
                      <span>Task</span>
                    </button>
                    <button
                      onClick={() => {
                        close();
                        setIsMobileOpen(false);
                        setIsApplyOffsetOpen(true);
                      }}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                    >
                      <Clock size={14} />
                      <span>Offset / Overtime</span>
                    </button>
                    {(hasSales || user?.isSuperAdmin || user?.isHr) && (
                      <button
                        onClick={() => {
                          close();
                          setIsMobileOpen(false);
                          setIsOpportunityOpen(true);
                        }}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-semibold text-sidebar-foreground hover:bg-sidebar-accent transition-colors text-left"
                      >
                        <Target size={14} />
                        <span>SOR</span>
                      </button>
                    )}
                  </div>
                )}
              </Dropdown>
            )}
          </div>
        </div>

        {/* 4. Combined Workspace Menus */}
        <div className="px-3 flex-1 flex flex-col text-sidebar-foreground/80 pb-4">
          <nav className="flex flex-col gap-5 mb-6 mt-2">
            {activeGroups.map(([key, group]) => (
              <div key={key} className="flex flex-col">
                <div
                  onClick={() => toggleGroup(key)}
                  className="px-3 mb-1.5 flex items-center justify-between text-sidebar-foreground/60 group/header cursor-pointer transition-colors hover:text-sidebar-foreground"
                >
                  <span className="text-[11px] font-black tracking-widest uppercase">
                    {group.label}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`transition-transform duration-200 ${expandedGroups[key] ? "rotate-180" : ""
                      }`}
                  />
                </div>
                <div
                  className={`flex flex-col gap-1 overflow-hidden transition-all duration-300 ${expandedGroups[key] ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
                    }`}
                >
                  {group.links.map((navLink) => {
                    const Icon = navLink.icon;
                    return (
                      <NavLink
                        key={navLink.label}
                        to={navLink.link}
                        end={
                          navLink.link === "/" ||
                          navLink.link === "/approvals/tasks" ||
                          navLink.link === "/approvals/hr-verification" ||
                          navLink.link === "/super-admin"
                        }
                        onClick={() => setIsMobileOpen(false)}
                        className={({ isActive }) =>
                          `flex gap-3.5 items-center px-3 py-2.5 rounded-md transition-colors ${isActive
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
                              className={`transition-colors ${isActive ? "text-sidebar-primary" : "text-sidebar-foreground/60"
                                }`}
                            />
                            <span
                              className={`truncate text-[13.5px] mt-[1px] transition-all ${isActive ? "font-bold text-sidebar-primary" : "font-medium"
                                }`}
                            >
                              {navLink.label}
                            </span>
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <RoleSwitcher />
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
      {canManage && (
        <CreateGroupTaskModal
          isOpen={isCreateGroupOpen}
          onClose={() => setIsCreateGroupOpen(false)}
          user={user}
          employees={employees}
          onSubmit={(payload) => createGroupMutation.mutateAsync(payload)}
          isSubmitting={createGroupMutation.isPending}
        />
      )}
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
