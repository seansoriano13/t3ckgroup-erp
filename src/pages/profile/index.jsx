import { FileInput } from "@/components/ui/FileInput";
import {
  Mail,
  Building2,
  Briefcase,
  Hash,
  ShieldCheck,
  UploadCloud,
  Sparkles,
  Save,
  PenLine,
} from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "../../context/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { storageService } from "../../services/storageService";
import { employeeService } from "../../services/employeeService";
import { signatureService } from "../../services/signatureService";
import { passwordService } from "../../services/passwordService";
import { aiService } from "../../services/aiService";
import ImageCropModal from "../../components/ImageCropModal";
import SignatureCaptureModal from "../../components/profile/SignatureCaptureModal";
import { TASK_STATUS } from "../../constants/status";
import PageHeader from "../../components/ui/PageHeader";
import PageContainer from "../../components/ui/PageContainer";
import { Input } from "@/components/ui/input";

import { Textarea } from "@/components/ui/textarea";
const UNSPLASH_BANNER_POOL = [
  "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1600&q=80",
  "https://images.unsplash.com/photo-1518173946687-a4c8892bbd9f?auto=format&fit=crop&w=1600&q=80",
];

export default function ProfilePage() {
  const { user, updateUserPreferences } = useAuth();
  const avatarInputRef = useRef(null);
  const bannerInputRef = useRef(null);

  const isHttpUrl = (value) => /^https?:\/\//i.test(value || "");

  const [customQuote, setCustomQuote] = useState(() => user?.dashboardQuote || "");
  const [prevDashboardQuote, setPrevDashboardQuote] = useState(
    user?.dashboardQuote,
  );
  if (user?.dashboardQuote !== prevDashboardQuote) {
    setPrevDashboardQuote(user?.dashboardQuote);
    setCustomQuote(user?.dashboardQuote || "");
  }

  const [avatarFile, setAvatarFile] = useState(null);
  const [bannerFile, setBannerFile] = useState(null);
  const [isSendingPasswordReset, setIsSendingPasswordReset] = useState(false);

  // Changing a password — whether this is the first time or the tenth —
  // always goes through the provider's email verification flow. There is no
  // inline "type your new password" form: this only asks for a reset email.
  const handleChangePassword = async () => {
    if (!user?.email) return;
    setIsSendingPasswordReset(true);
    try {
      await passwordService.requestPasswordReset(user.email);
      toast.success("Check your email for a link to set a new password.");
    } catch (error) {
      console.error("Password reset request failed:", error);
      toast.error(error.message || "Could not send reset email.");
    } finally {
      setIsSendingPasswordReset(false);
    }
  };

  const [bannerUrlInput, setBannerUrlInput] = useState(() =>
    isHttpUrl(user?.dashboardBannerPath) ? user.dashboardBannerPath : "",
  );
  const [prevDashboardBannerPath, setPrevDashboardBannerPath] = useState(
    user?.dashboardBannerPath,
  );
  if (user?.dashboardBannerPath !== prevDashboardBannerPath) {
    setPrevDashboardBannerPath(user?.dashboardBannerPath);
    setBannerUrlInput(
      isHttpUrl(user?.dashboardBannerPath) ? user.dashboardBannerPath : "",
    );
  }

  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [removeQuote, setRemoveQuote] = useState(false);
  // Crop modal
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [pendingAvatarFile, setPendingAvatarFile] = useState(null);

  // Signature
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const { data: signatureUrl, isLoading: isSignatureLoading } = useQuery({
    queryKey: ["signatureUrl", user?.signaturePath],
    queryFn: () => signatureService.getSignatureUrl(user.signaturePath),
    enabled: !!user?.signaturePath,
  });

  const avatarFileObjectUrl = useMemo(() => {
    if (!avatarFile) return null;
    return URL.createObjectURL(avatarFile);
  }, [avatarFile]);

  useEffect(() => {
    if (avatarFileObjectUrl) {
      return () => URL.revokeObjectURL(avatarFileObjectUrl);
    }
  }, [avatarFileObjectUrl]);

  const avatarPreviewUrl = avatarFileObjectUrl
    ? avatarFileObjectUrl
    : removeAvatar
      ? "/default-avatar.png"
      : user?.picture || "/default-avatar.png";

  const bannerFileObjectUrl = useMemo(() => {
    if (!bannerFile) return null;
    return URL.createObjectURL(bannerFile);
  }, [bannerFile]);

  useEffect(() => {
    if (bannerFileObjectUrl) {
      return () => URL.revokeObjectURL(bannerFileObjectUrl);
    }
  }, [bannerFileObjectUrl]);

  const bannerPreviewUrl = bannerFileObjectUrl
    ? bannerFileObjectUrl
    : removeBanner
      ? "/leaf-background.jpg"
      : (bannerUrlInput || "").trim()
        ? bannerUrlInput.trim()
        : user?.dashboardBannerUrl || "/leaf-background.jpg";

  const { data: stats, isLoading: isStatsLoading } = useQuery({
    queryKey: ["profileStats", user?.id],
    queryFn: async () => {
      if (user?.isSuperAdmin) return null;

      const userDept = user?.department || "";

      if (user?.isHr || user?.is_hr) {
        // HR Access
        const { count: pendingVerifications } = await supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("hr_verified", false)
          .eq("status", TASK_STATUS.COMPLETE);
        const { count: totalVerified } = await supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("hr_verified", true);

        return {
          primary: pendingVerifications || 0,
          primaryLabel: "Pending HR Verifications",
          secondary: totalVerified || 0,
          secondaryLabel: "Total Verified",
        };
      } else if (user?.isHead || user?.is_head) {
        // Department Head logic
        const { count: pendingApprovals } = await supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("department", userDept)
          .eq("status", TASK_STATUS.AWAITING_APPROVAL);

        const { count: totalApproved } = await supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("department", userDept)
          .in("status", [TASK_STATUS.COMPLETE, TASK_STATUS.NOT_APPROVED]);

        return {
          primary: pendingApprovals || 0,
          primaryLabel: "Awaiting Your Approval",
          secondary: totalApproved || 0,
          secondaryLabel: "Your Evaluated Tasks",
        };
      } else {
        // Regular Employee logic
        const { count: totalLogged } = await supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("logged_by", user.id)
          .neq("status", TASK_STATUS.DELETED);

        const { count: totalDone } = await supabase
          .from("tasks")
          .select("*", { count: "exact", head: true })
          .eq("logged_by", user.id)
          .eq("status", TASK_STATUS.COMPLETE);

        return {
          primary: totalLogged || 0,
          primaryLabel: "Total Tasks Logged",
          secondary: totalDone || 0,
          secondaryLabel: "Activities Completed",
        };
      }
    },
    enabled: !!user?.id,
  });

  const generateQuoteMutation = useMutation({
    mutationFn: async () => {
      return aiService.getRandomMotivationalQuote(
        user?.name?.split(" ")?.[0] || "Team",
      );
    },
    onSuccess: (quote) => {
      setCustomQuote(quote);
      setRemoveQuote(false);
      toast.success("Picked a random motivational quote.");
    },
    onError: () => {
      toast.error("Could not generate quote right now.");
    },
  });

  const savePreferencesMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("Missing user session.");

      let avatarPath = removeAvatar ? null : user?.avatarPath || null;
      let dashboardBannerPath = removeBanner
        ? null
        : user?.dashboardBannerPath || null;

      if (avatarFile) {
        avatarPath = await storageService.uploadProfileImage(
          user.id,
          "avatar",
          avatarFile,
        );
      }
      if (bannerFile) {
        dashboardBannerPath = await storageService.uploadProfileImage(
          user.id,
          "banner",
          bannerFile,
        );
      } else if ((bannerUrlInput || "").trim()) {
        dashboardBannerPath = bannerUrlInput.trim();
      }

      const dashboardQuote = removeQuote
        ? ""
        : customQuote.trim().slice(0, 100);

      const updated = await employeeService.updateSelfPreferences(user.id, {
        avatarPath,
        dashboardBannerPath,
        dashboardQuote: dashboardQuote || null,
      });

      const [picture, dashboardBannerUrl] = await Promise.all([
        updated.avatar_path
          ? isHttpUrl(updated.avatar_path)
            ? updated.avatar_path
            : storageService.getSignedUrl(updated.avatar_path)
          : null,
        updated.dashboard_banner_path
          ? isHttpUrl(updated.dashboard_banner_path)
            ? updated.dashboard_banner_path
            : storageService.getSignedUrl(updated.dashboard_banner_path)
          : null,
      ]);

      return {
        avatarPath: updated.avatar_path || null,
        dashboardBannerPath: updated.dashboard_banner_path || null,
        dashboardQuote: updated.dashboard_quote || "",
        picture: picture || user?.picture || "",
        dashboardBannerUrl: dashboardBannerUrl || null,
      };
    },
    onSuccess: (nextUserValues) => {
      updateUserPreferences(nextUserValues);
      setAvatarFile(null);
      setBannerFile(null);
      setRemoveAvatar(false);
      setRemoveBanner(false);
      setRemoveQuote(false);
      setBannerUrlInput(
        isHttpUrl(nextUserValues.dashboardBannerPath)
          ? nextUserValues.dashboardBannerPath
          : "",
      );
      toast.success("Dashboard preferences saved.");
    },
    onError: (error) => {
      toast.error(error?.message || "Failed to save preferences.");
    },
  });

  const isSaving = savePreferencesMutation.isPending;
  const quoteLength = customQuote.trim().length;
  const hasBannerUrl = (bannerUrlInput || "").trim().length > 0;
  const isUsingDefaultBanner =
    removeBanner ||
    (!bannerFile && !hasBannerUrl && !user?.dashboardBannerPath);
  const isUsingDefaultAvatar =
    removeAvatar || (!avatarFile && !user?.avatarPath);
  const isUsingDefaultQuote = removeQuote || quoteLength === 0;

  const initialQuote = (user?.dashboardQuote || "").trim();
  const initialBannerUrl = (
    isHttpUrl(user?.dashboardBannerPath) ? user.dashboardBannerPath : ""
  ).trim();

  const hasChanges =
    !!avatarFile ||
    !!bannerFile ||
    removeAvatar ||
    removeBanner ||
    removeQuote ||
    customQuote.trim() !== initialQuote ||
    bannerUrlInput.trim() !== initialBannerUrl;

  return (
    <PageContainer maxWidth="7xl" className="pt-4">
      <PageHeader
        title="My Profile"
        description="Manage your employee information and access levels."
      >
        <Button
          type="button"
          onClick={() => savePreferencesMutation.mutate()}
          disabled={isSaving || !hasChanges}
          className="h-auto gap-2 rounded-full px-5 py-2.5 text-[11px] font-black uppercase tracking-widest shadow-sm disabled:opacity-70"
        >
          {isSaving ? <Spinner size="sm" /> : <Save size={16} />}
          Save Settings
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN: The ID Card */}
        <div className="lg:col-span-1 h-full">
          <div className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-3 items-center text-center shadow-sm h-full justify-center">
            <div className="relative">
              <img
                src={user?.picture || "/default-avatar.png"}
                alt="Profile"
                className="w-24 h-24 rounded-full border border-border shadow-sm mb-3 object-cover"
                referrerPolicy="no-referrer"
              />
              {/* Role Badges floating on the avatar */}
              {(user?.isHead || user?.isHr) && (
                <div className="flex gap-2 mb-1">
                  {user?.isHead && (
                    <span className="bg-transparent text-amber-11 border border-amber-6 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
                      Head
                    </span>
                  )}
                  {user?.isHr && (
                    <span className="bg-transparent text-violet-11 border border-violet-6 text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-widest">
                      HR
                    </span>
                  )}
                </div>
              )}
            </div>

            <div>
              <h2 className="text-xl font-black text-foreground">
                {user?.name || "Employee Name"}
              </h2>
              <p className="text-muted-foreground text-sm mt-1 flex items-center gap-2 justify-center">
                <Mail size={13} /> {user?.email || "email@t3ckgroup.com"}
              </p>
              <Button
                type="button"
                variant="link"
                onClick={handleChangePassword}
                disabled={isSendingPasswordReset}
                className="mt-3 h-auto p-0 text-xs font-bold text-foreground disabled:opacity-60"
              >
                {isSendingPasswordReset ? "Sending..." : "Change Password"}
              </Button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Details & Stats */}
        <div className="lg:col-span-2 space-y-6 flex flex-col">
          {/* Department Info */}
          <div className="bg-card border border-border rounded-2xl p-8 shadow-sm flex-1">
            <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] mb-5 border-b border-border pb-3">
              Organizational Details
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 bg-muted/50 border border-border rounded-xl flex items-center justify-center text-foreground">
                  <Building2 size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    Department
                  </p>
                  <p className="text-foreground font-black mt-0.5 text-sm">
                    {user?.department || "Unassigned"}
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start">
                <div className="w-10 h-10 bg-muted/50 border border-border rounded-xl flex items-center justify-center text-foreground">
                  <Briefcase size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    Sub-Department
                  </p>
                  <p className="text-foreground font-black mt-0.5 text-sm">
                    {user?.subDepartment || "N/A"}
                  </p>
                </div>
              </div>

              <div className="flex gap-4 items-start sm:col-span-2 border-t border-border pt-4 mt-2">
                <div className="w-10 h-10 bg-muted/50 border border-border rounded-xl flex items-center justify-center text-foreground">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    System ID
                  </p>
                  <p className="text-muted-foreground font-mono text-xs mt-1 break-all select-all">
                    {user?.id || "UUID_PENDING"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Signature */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between border-b border-border pb-3 mb-5">
              <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                Signature
              </h3>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSignatureModalOpen(true)}
                className="h-auto gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-muted"
              >
                <PenLine size={14} /> {user?.signaturePath ? "Replace" : "Add Signature"}
              </Button>
            </div>
            <div className="rounded-xl border-2 border-dashed border-border bg-[repeating-linear-gradient(45deg,var(--color-muted)_0,var(--color-muted)_10px,transparent_10px,transparent_20px)] min-h-[100px] flex items-center justify-center">
              {isSignatureLoading ? (
                <Spinner size="sm" />
              ) : signatureUrl ? (
                <img src={signatureUrl} alt="Your signature" className="max-h-24 max-w-[80%] object-contain" />
              ) : (
                <p className="text-xs text-muted-foreground font-medium">No signature on file yet.</p>
              )}
            </div>
          </div>

          {/* Live Dynamic Stats */}
          {!user?.isSuperAdmin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-violet-2 border border-mauve-3 rounded-2xl flex items-center justify-center text-violet-9">
                  <Hash size={20} />
                </div>
                <div>
                  <p className="text-2xl font-black text-foreground">
                    {isStatsLoading ? <Spinner size="sm" /> : stats?.primary}
                  </p>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    {stats?.primaryLabel || "Metrics"}
                  </p>
                </div>
              </div>
              <div className="bg-card border border-border rounded-2xl p-5 shadow-sm flex items-center gap-4">
                <div className="w-12 h-12 bg-green-2 border border-green-3 rounded-2xl flex items-center justify-center text-green-9">
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <p className="text-2xl font-black text-green-10">
                    {isStatsLoading ? <Spinner size="sm" /> : stats?.secondary}
                  </p>
                  <p className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.15em]">
                    {stats?.secondaryLabel || "Completed"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 bg-card border border-border rounded-2xl p-5 md:p-6 shadow-sm space-y-5">
          <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h3 className="text-base font-black text-foreground">
                Dashboard Personalization
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Banner, quote, and avatar apply across all dashboard views.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
            <div className="bg-muted/40 border-b border-border px-4 py-2.5 flex items-center gap-3">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-amber-400"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
              </div>
              <div className="flex-1 flex justify-center">
                <div className="h-4 bg-muted/60 rounded-full w-full max-w-[200px]"></div>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                Live Preview
              </p>
              <div className="relative rounded-lg overflow-hidden h-28 border border-border">
                <img
                  src={bannerPreviewUrl || "/leaf-background.jpg"}
                  alt="Banner preview"
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/35" />
                <div className="absolute left-3 right-3 bottom-2 flex items-center justify-between gap-2">
                  <p className="text-[11px] text-primary-foreground/90 font-semibold">
                    Dashboard banner preview
                  </p>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-black/50 text-primary-foreground/90 border border-white/20">
                    {isUsingDefaultBanner ? "Default" : "Custom"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black text-foreground uppercase tracking-widest">
                    Profile photo
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[150px]">
                    {avatarFile ? avatarFile.name : "Custom avatar or default"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => avatarInputRef.current?.open()}
                    className="h-auto gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-muted"
                  >
                    <UploadCloud size={14} /> Upload
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAvatarFile(null);
                      setRemoveAvatar(true);
                    }}
                    disabled={isUsingDefaultAvatar}
                    className="h-auto rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest enabled:hover:bg-muted/50 disabled:opacity-50"
                  >
                    Reset
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <img
                  src={avatarPreviewUrl || "/default-avatar.png"}
                  alt="Avatar preview"
                  className="w-10 h-10 rounded-full object-cover border border-border shadow-sm"
                />
                <span className="text-xs text-muted-foreground font-medium">
                  Profile photo preview (
                  {isUsingDefaultAvatar ? "Default" : "Custom"})
                </span>
              </div>
              <FileInput
                ref={avatarInputRef}
                accept="image/*"
                onFiles={([selected]) => {
                  setPendingAvatarFile(selected);
                  setCropModalOpen(true);
                  setRemoveAvatar(false);
                }}
              />
            </div>

            <div className="space-y-4 rounded-xl border border-border bg-card p-5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black text-foreground uppercase tracking-widest">
                    Dashboard banner
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate max-w-[150px]">
                    {bannerFile ? bannerFile.name : "URL, upload, or random"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => bannerInputRef.current?.open()}
                    className="h-auto gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-muted"
                  >
                    <UploadCloud size={14} /> Upload
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const randomBanner =
                        UNSPLASH_BANNER_POOL[
                          Math.floor(
                            Math.random() * UNSPLASH_BANNER_POOL.length,
                          )
                        ];
                      setBannerUrlInput(randomBanner);
                      setBannerFile(null);
                      setRemoveBanner(false);
                    }}
                    className="h-auto gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-muted"
                  >
                    Random
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setBannerFile(null);
                      setBannerUrlInput("");
                      setRemoveBanner(true);
                    }}
                    disabled={isUsingDefaultBanner}
                    className="h-auto rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest enabled:hover:bg-muted/50 disabled:opacity-50"
                  >
                    Reset
                  </Button>
                </div>
              </div>
              <FileInput
                ref={bannerInputRef}
                accept="image/*"
                onCancel={() => {
                  setBannerFile(null);
                  setBannerUrlInput("");
                  setRemoveBanner(false);
                }}
                onFiles={([selected]) => {
                  setBannerFile(selected);
                  setBannerUrlInput("");
                  setRemoveBanner(false);
                }}
              />
              <Input
                type="url"
                value={bannerUrlInput}
                onChange={(e) => {
                  setBannerUrlInput(e.target.value);
                  setBannerFile(null);
                  setRemoveBanner(false);
                }}
                containerClassName="w-full"
                placeholder="Paste Unsplash image URL"
              />
            </div>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <p className="text-[10px] font-black text-foreground uppercase tracking-widest">
                  Motivational Quote
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Set a daily reminder for yourself.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-mauve-8 mr-1 font-semibold">
                  {quoteLength}/100
                </span>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => generateQuoteMutation.mutate()}
                  disabled={generateQuoteMutation.isPending}
                  className="h-auto gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-foreground hover:bg-muted disabled:opacity-70"
                >
                  {generateQuoteMutation.isPending ? (
                    <Spinner size="sm" />
                  ) : (
                    <Sparkles size={14} />
                  )}
                  Random
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCustomQuote("");
                    setRemoveQuote(true);
                  }}
                  disabled={isUsingDefaultQuote}
                  className="h-auto rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest enabled:hover:bg-muted/50 disabled:opacity-50"
                >
                  Reset
                </Button>
              </div>
            </div>
            <Textarea
              value={customQuote}
              maxLength={100}
              onChange={(e) => {
                setCustomQuote(e.target.value);
                setRemoveQuote(false);
              }}
              className="min-h-[70px] resize-none p-4 text-sm"
              placeholder="Write your 7-word motivational quote (all users)..."
            />
          </div>
        </div>
      </div>
      <ImageCropModal
        file={pendingAvatarFile}
        isOpen={cropModalOpen}
        onConfirm={(croppedFile) => {
          setAvatarFile(croppedFile);
          setPendingAvatarFile(null);
          setCropModalOpen(false);
        }}
        onCancel={() => {
          setPendingAvatarFile(null);
          setCropModalOpen(false);
        }}
      />
      <SignatureCaptureModal
        isOpen={signatureModalOpen}
        onClose={() => setSignatureModalOpen(false)}
        employeeId={user?.id}
        onSuccess={(updated) => updateUserPreferences({ signaturePath: updated.signature_path })}
      />
    </PageContainer>
  );
}
