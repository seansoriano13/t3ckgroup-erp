import { Bell, Moon, Sun, LogOut, Shield, HelpCircle, Sparkles, ArrowRight, BookOpen, Megaphone, Users } from "lucide-react";
import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import FAQModal from "./_components/FAQModal";
import ChangelogModal from "../../components/ChangelogModal";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import TabGroup from "@/components/ui/TabGroup";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../hooks/useTheme";
import { getPermissionContext } from "../../utils/permissions";
import { canEditFAQ } from "../../utils/faqAccess";

import { useAppSettings } from "@/hooks/useAppSettings";
import toast from "react-hot-toast";
import PageShell from "../../components/ui/PageShell";
import { formatBuildFingerprint } from "@/utils/buildFingerprint";
import LeaveCategoriesConfig from "../../components/hr/LeaveCategoriesConfig";
import DayShiftConfig from "../../components/settings/DayShiftConfig";
import LeadSourceManager from "../../components/settings/LeadSourceManager";
import EmployeeGroupManager from "../../components/settings/EmployeeGroupManager";
import SystemUpdateBanner from "../../components/SystemUpdateBanner";
import SystemUpdateManager from "../../components/SystemUpdateManager";
import { isPushSupported, isPushEnabled, enablePushNotifications, disablePushNotifications } from "../../utils/pushNotifications";

const appSemver = __APP_SEMVER__;
const buildFingerprint = formatBuildFingerprint(__APP_VERSION__, __BUILD_TIME__);

function SettingToggle({ label, description, icon: Icon, checked, onToggle, isPending, isLoading }) {
  return (
    <div className="p-5 flex items-center justify-between hover:bg-muted/30 transition-colors group">
      <div className="flex items-center gap-4">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${checked ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          <Icon size={18} />
        </div>
        <div>
          <p className="font-bold text-foreground text-sm">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-sm leading-relaxed">{description}</p>
        </div>
      </div>
      {isLoading ? (
        <Spinner size="sm" />
      ) : (
        <div
          onClick={!isPending ? onToggle : undefined}
          className={`w-11 h-6 rounded-full relative cursor-pointer transition-all duration-200 shrink-0 ${
            checked ? "bg-primary shadow-sm" : "bg-mauve-5"
          } ${isPending ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div className={`absolute top-1 bg-mauve-1 w-4 h-4 rounded-full shadow transition-all duration-200 ${checked ? "right-1" : "left-1"}`} />
        </div>
      )}
    </div>
  );
}

function GeneralPanel() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [showChangelog, setShowChangelog] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const canEditFAQContent = canEditFAQ(user);

  useEffect(() => {
    isPushEnabled().then(setPushEnabled);
  }, []);

  const togglePush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePushNotifications(user.id);
        setPushEnabled(false);
      } else {
        const granted = await enablePushNotifications(user.id);
        if (granted) {
          setPushEnabled(true);
        } else {
          toast.error("Desktop notifications were not enabled.");
        }
      }
    } catch (err) {
      toast.error(err.message || "Could not update desktop notifications.");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <>
      <ChangelogModal manualOpen={showChangelog} onManualClose={() => setShowChangelog(false)} />

      {/* PREFERENCES SECTION */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-muted/30">
          <h2 className="text-sm font-semibold text-foreground">
            App preferences
          </h2>
        </div>

        <div className="divide-y divide-border">
          {/* Theme Toggle */}
          <div className="p-5 flex items-center justify-between hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-4">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${theme === "dark" ? "bg-primary/10 text-primary" : "bg-mauve-4 text-mauve-10"}`}>
                {theme === "dark" ? <Moon size={18} /> : <Sun size={18} />}
              </div>
              <div>
                <p className="font-bold text-foreground text-sm">Theme Mode</p>
                <p className="text-xs text-muted-foreground mt-0.5">Toggle between light and dark themes.</p>
              </div>
            </div>
            <div
              onClick={toggleTheme}
              className={`w-11 h-6 rounded-full relative cursor-pointer transition-all duration-200 shrink-0 ${
                theme === "dark" ? "bg-primary shadow-sm" : "bg-mauve-5"
              }`}
            >
              <div className={`absolute top-1 bg-mauve-1 w-4 h-4 rounded-full shadow transition-all duration-200 ${theme === "dark" ? "right-1" : "left-1"}`} />
            </div>
          </div>

          {/* Desktop push notifications — #166/#167 */}
          {isPushSupported() && (
            <SettingToggle
              label="Desktop Notifications"
              description="Get notified on this device when someone mentions you, assigns you a task, decides on your request, or needs your approval — even with the portal closed."
              icon={Bell}
              checked={pushEnabled}
              onToggle={togglePush}
              isPending={pushBusy}
            />
          )}

          {/* What's New row */}
          <div
            className="p-5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer group"
            onClick={() => setShowChangelog(true)}
          >
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                <Sparkles size={18} />
              </div>
              <div>
                <p className="font-bold text-foreground text-sm">What's New</p>
                <p className="text-xs text-muted-foreground mt-0.5">View the latest updates and release notes.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pr-2">
              <span className="text-xs font-semibold text-muted-foreground">v{appSemver}</span>
              <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                <ArrowRight size={16} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* CONTENT SECTION — #177: FAQ editing was reachable only through a
          button buried in the Help modal and its route had no guard of
          its own; gated by the same predicate that button already used. */}
      {canEditFAQContent && (
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <h2 className="text-sm font-semibold text-foreground">
              Content
            </h2>
          </div>
          <div
            className="p-5 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-pointer group"
            onClick={() => navigate("/settings/FAQEditor")}
          >
            <div className="flex items-center gap-4">
              <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground group-hover:text-foreground transition-colors">
                <BookOpen size={18} />
              </div>
              <div>
                <p className="font-bold text-foreground text-sm">FAQ Editor</p>
                <p className="text-xs text-muted-foreground mt-0.5">Edit the Help &amp; FAQ content shown to every role.</p>
              </div>
            </div>
            <ArrowRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          </div>
        </div>
      )}

      {/* DANGER ZONE SECTION */}
      <div className="bg-card border border-destructive/20 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-destructive/5 flex items-center gap-2.5">
          <h2 className="text-sm font-semibold text-destructive">
            Account actions
          </h2>
        </div>

        <div className="p-6">
          <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
            Logging out will clear your current session. You will need to
            re-authenticate with your T3CKGROUP Google account to access the
            portal again.
          </p>
          <Button
            variant="outline"
            onClick={logout}
            className="h-auto gap-2 rounded-xl bg-card px-6 py-2.5 font-bold text-destructive shadow-sm border-destructive/30 hover:border-destructive hover:bg-destructive hover:text-mauve-1"
          >
            <LogOut size={18} />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Build fingerprint — for support conversations, not the reader */}
      <div className="flex items-center justify-center">
        <span className="text-[10px] text-muted-foreground/40">{buildFingerprint}</span>
      </div>
    </>
  );
}

function ApprovalRulesPanel() {
  const { settings: appSettings, updateSetting, isPending, isLoading: loadingSettings } = useAppSettings();

  const toggle = (key) => () =>
    !isPending &&
    updateSetting(
      { [key]: !appSettings[key] },
      { onSuccess: () => toast.success("Security configuration updated system-wide!") },
    );

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl pointer-events-none -mr-20 -mt-20" />
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5 relative z-10">
        <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
          <Shield size={14} className="text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">
          Approval rules
        </h2>
      </div>
      <div className="divide-y divide-border relative z-10">
        <SettingToggle
          label="Ops Manager Marketing Approvals"
          description="When ON, the Operations Manager can also approve/reject 'Awaiting Approval' tasks created by Marketing employees. When OFF, only Super Admins can process these."
          icon={Shield}
          checked={!!appSettings?.marketing_approval_by_ops_manager}
          onToggle={toggle("marketing_approval_by_ops_manager")}
          isPending={isPending}
          isLoading={loadingSettings}
        />
        <SettingToggle
          label="Universal Task Submission"
          description="All employees can explicitly submit tasks for manager review before approval. Heads will see submitted tasks in their approval queue."
          icon={Shield}
          checked={!!appSettings?.universal_task_submission}
          onToggle={toggle("universal_task_submission")}
          isPending={isPending}
          isLoading={loadingSettings}
        />
        <SettingToggle
          label="Enable Task Self-Verification"
          description="Allow employees to self-verify their own tasks if a manager has not responded after 48 hours. These will be flagged for HR audit."
          icon={Shield}
          checked={!!appSettings?.enable_self_verification}
          onToggle={toggle("enable_self_verification")}
          isPending={isPending}
          isLoading={loadingSettings}
        />
        <SettingToggle
          label="Enable Manager Bulk Approval"
          description="Allow Super Admins to bulk-approve delayed pending tasks to clear bottlenecks."
          icon={Shield}
          checked={!!appSettings?.enable_bulk_approval}
          onToggle={toggle("enable_bulk_approval")}
          isPending={isPending}
          isLoading={loadingSettings}
        />
        <SettingToggle
          label="Visual Urgency Indicators (Bottleneck Tracking)"
          description='Highlight tasks waiting more than 48 hours for a manager with a "DELAYED" badge in the action queue.'
          icon={Shield}
          checked={!!appSettings?.enable_visual_shaming}
          onToggle={toggle("enable_visual_shaming")}
          isPending={isPending}
          isLoading={loadingSettings}
        />
      </div>
    </div>
  );
}

function HrPanel() {
  const { user } = useAuth();
  const { isSuperAdmin } = getPermissionContext(user);
  return (
    <>
      <LeaveCategoriesConfig />
      {isSuperAdmin && <DayShiftConfig />}
    </>
  );
}

function SalesPanel() {
  return (
    <>
      <LeadSourceManager />
      <Link
        to="/sors/commission?tab=formula"
        className="bg-card border border-border rounded-2xl shadow-sm p-5 flex items-center justify-between hover:bg-muted/30 transition-colors group outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div>
          <p className="font-bold text-foreground text-sm">Commission Pool</p>
          <p className="text-xs text-muted-foreground mt-0.5">Rates and department allocations.</p>
        </div>
        <ArrowRight size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
      </Link>
    </>
  );
}

function EmployeeGroupsPanel() {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
          <Users size={14} className="text-muted-foreground" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">
          Employee groups
        </h2>
      </div>
      <EmployeeGroupManager />
    </div>
  );
}

function AnnouncementsPanel() {
  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
          <Megaphone size={14} className="text-primary" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">
          System announcements
        </h2>
      </div>
      <SystemUpdateBanner />
      <SystemUpdateManager />
    </div>
  );
}

/** Each tab and the one panel it mounts. General comes first and is the fallback. */
const TAB_DEFS = [
  { value: "general", label: "General", isPermitted: () => true, Panel: GeneralPanel },
  { value: "approvals", label: "Approval Rules", isPermitted: (c) => c.isSuperAdmin, Panel: ApprovalRulesPanel },
  { value: "hr", label: "HR & Schedule", isPermitted: (c) => c.isSuperAdmin || c.isHr, Panel: HrPanel },
  { value: "sales", label: "Sales Configuration", isPermitted: (c) => c.isSuperAdmin, Panel: SalesPanel },
  { value: "groups", label: "Employee Groups", isPermitted: (c) => c.isSuperAdmin, Panel: EmployeeGroupsPanel },
  { value: "announcements", label: "System Announcements", isPermitted: (c) => c.isSuperAdmin, Panel: AnnouncementsPanel },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showFAQ, setShowFAQ] = useState(false);

  const permissionContext = getPermissionContext(user);
  const visibleTabs = TAB_DEFS.filter((t) => t.isPermitted(permissionContext));
  const requestedTab = searchParams.get("tab");
  const requested = visibleTabs.find((t) => t.value === requestedTab);
  const { value: activeTab, Panel: ActivePanel } = requested ?? TAB_DEFS[0];

  useEffect(() => {
    if (requestedTab && !requested) {
      setSearchParams({ tab: TAB_DEFS[0].value }, { replace: true });
    }
  }, [requestedTab, requested, setSearchParams]);

  return (
    <PageShell
      frame="narrow"
      title="Settings"
      description="Configure your portal experience."
      action={
        <Button id="open-faq-btn" variant="outline" onClick={() => setShowFAQ(true)}>
          <HelpCircle size={15} />
          Help & FAQ
        </Button>
      }
      tabs={
        <TabGroup
          variant="underline"
          size="md"
          tabs={visibleTabs.map(({ value, label }) => ({ value, label }))}
          activeTab={activeTab}
          onChange={(value) => setSearchParams({ tab: value })}
        />
      }
    >
      <FAQModal isOpen={showFAQ} onClose={() => setShowFAQ(false)} />

      {/* Only the active panel is mounted, so an inactive tab issues no queries. */}
      <div className="space-y-6">
        <ActivePanel />
      </div>

      {/* FAQ floating hint */}
      <div className="mt-8 flex items-center justify-center">
        <Button
          variant="link"
          onClick={() => setShowFAQ(true)}
          className="h-auto gap-1.5 p-0 text-xs font-normal text-muted-foreground/60 hover:text-muted-foreground hover:no-underline"
        >
          <HelpCircle size={12} />
          Have questions? View the Help & FAQ
        </Button>
      </div>
    </PageShell>
  );
}
