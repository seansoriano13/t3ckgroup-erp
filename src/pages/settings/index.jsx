import { Bell, Moon, Sun, LogOut, Shield, HelpCircle, Sparkles, ArrowRight } from "lucide-react";
import { useState } from "react";
import FAQModal from "./FAQModal";
import ChangelogModal from "../../components/ChangelogModal";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../hooks/useTheme";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { appSettingsService } from "../../services/appSettingsService";
import toast from "react-hot-toast";
import PageHeader from "../../components/ui/PageHeader";
import PageContainer from "../../components/ui/PageContainer";

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

export default function SettingsPage() {
  const { logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();
  const [showFAQ, setShowFAQ] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  // const isHr = user?.is_hr === true || user?.isHr === true;
  const isSuperAdmin = user?.isSuperAdmin;

  const { data: appSettings, isLoading: loadingSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: () => appSettingsService.getAppSettings(),
    enabled: !!isSuperAdmin,
  });

  const mutation = useMutation({
    mutationFn: (payload) => appSettingsService.updateAppSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appSettings"] });
      toast.success("Security configuration updated system-wide!");
    },
    onError: (err) => toast.error(err.message),
  });

  const toggle = (key) => () =>
    !mutation.isPending && mutation.mutate({ [key]: !appSettings?.[key] });

  return (
    <PageContainer maxWidth="4xl" className="pt-4">
      <FAQModal isOpen={showFAQ} onClose={() => setShowFAQ(false)} />
      <ChangelogModal manualOpen={showChangelog} onManualClose={() => setShowChangelog(false)} />

      <div className="flex items-start justify-between gap-4 mb-6">
        <PageHeader
          title="Settings"
          description="Configure your portal experience."
        />
        <button
          id="open-faq-btn"
          onClick={() => setShowFAQ(true)}
          className="shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-card border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-all shadow-sm"
        >
          <HelpCircle size={15} />
          Help & FAQ
        </button>
      </div>

      <div className="space-y-6">
        {/* PREFERENCES SECTION */}
        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-muted/30">
            <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
              App Preferences
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

            {/* Notifications row */}
            <div className="p-5 flex items-center justify-between hover:bg-muted/30 transition-colors">
              <div className="flex items-center gap-4">
                <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center text-muted-foreground">
                  <Bell size={18} />
                </div>
                <div>
                  <p className="font-bold text-foreground text-sm">Email Notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Get alerted when a manager reviews your task.</p>
                </div>
              </div>
              {/* Fake Toggle - Off */}
              <div className="w-11 h-6 bg-mauve-5 rounded-full relative cursor-pointer shrink-0">
                <div className="absolute left-1 top-1 bg-mauve-1 w-4 h-4 rounded-full shadow transition-all" />
              </div>
            </div>

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
              <div className="text-muted-foreground group-hover:text-foreground transition-colors pr-2">
                <ArrowRight size={16} />
              </div>
            </div>
          </div>
        </div>

        {/* SUPER ADMIN SECURITY SYSTEM ZONE */}
        {isSuperAdmin && (
          <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl pointer-events-none -mr-20 -mt-20" />
            <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5 relative z-10">
              <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield size={14} className="text-primary" />
              </div>
              <h2 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                Customization
              </h2>
            </div>
            <div className="divide-y divide-border relative z-10">
              <SettingToggle
                label="Ops Manager Marketing Approvals"
                description="When ON, the Operations Manager can also approve/reject 'Awaiting Approval' tasks created by Marketing employees. When OFF, only Super Admins can process these."
                icon={Shield}
                checked={!!appSettings?.marketing_approval_by_ops_manager}
                onToggle={toggle("marketing_approval_by_ops_manager")}
                isPending={mutation.isPending}
                isLoading={loadingSettings}
              />
              <SettingToggle
                label="Universal Task Submission"
                description="All employees can explicitly submit tasks for manager review before approval. Heads will see submitted tasks in their approval queue."
                icon={Shield}
                checked={!!appSettings?.universal_task_submission}
                onToggle={toggle("universal_task_submission")}
                isPending={mutation.isPending}
                isLoading={loadingSettings}
              />
              <SettingToggle
                label="Enable Task Self-Verification"
                description="Allow employees to self-verify their own tasks if a manager has not responded after 48 hours. These will be flagged for HR audit."
                icon={Shield}
                checked={!!appSettings?.enable_self_verification}
                onToggle={toggle("enable_self_verification")}
                isPending={mutation.isPending}
                isLoading={loadingSettings}
              />
              <SettingToggle
                label="Enable Manager Bulk Approval"
                description="Allow Super Admins to bulk-approve delayed pending tasks to clear bottlenecks."
                icon={Shield}
                checked={!!appSettings?.enable_bulk_approval}
                onToggle={toggle("enable_bulk_approval")}
                isPending={mutation.isPending}
                isLoading={loadingSettings}
              />
              <SettingToggle
                label="Visual Urgency Indicators (Bottleneck Tracking)"
                description='Highlight tasks waiting more than 48 hours for a manager with a "DELAYED" badge in the action queue.'
                icon={Shield}
                checked={!!appSettings?.enable_visual_shaming}
                onToggle={toggle("enable_visual_shaming")}
                isPending={mutation.isPending}
                isLoading={loadingSettings}
              />
            </div>
          </div>
        )}

        {/* DANGER ZONE SECTION */}
        <div className="bg-card border border-destructive/20 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border bg-destructive/5 flex items-center gap-2.5">
            <h2 className="text-[10px] font-black text-destructive/80 uppercase tracking-[0.2em]">
              Account Actions
            </h2>
          </div>

          <div className="p-6">
            <p className="text-sm text-muted-foreground mb-5 leading-relaxed">
              Logging out will clear your current session. You will need to
              re-authenticate with your T3CKGROUP Google account to access the
              portal again.
            </p>
            <button
              onClick={logout}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold bg-card text-destructive hover:bg-destructive hover:text-mauve-1 transition-all border border-destructive/30 hover:border-destructive shadow-sm"
            >
              <LogOut size={18} />
              Sign Out
            </button>
          </div>
        </div>
      </div>

      {/* FAQ floating hint */}
      <div className="mt-8 flex items-center justify-center">
        <button
          onClick={() => setShowFAQ(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors cursor-pointer"
        >
          <HelpCircle size={12} />
          Have questions? View the Help & FAQ
        </button>
      </div>
    </PageContainer>
  );
}
