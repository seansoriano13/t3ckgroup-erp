import React, { useState, useEffect } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabase";
import allChangelog from "@/data/changelog.json";
import { visibleEntries } from "../../scripts/lib/changelog.mjs";
import { isStaging } from "@/lib/appEnv";

const changelog = visibleEntries(allChangelog, isStaging);

export default function ChangelogModal({ manualOpen = false, onManualClose = null }) {
  const { user } = useAuth();
  const [autoOpen, setAutoOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const latestRelease = changelog[0];

  useEffect(() => {
    if (!user || !latestRelease || manualOpen) return;

    const localDismissedVersion = localStorage.getItem(`changelog_dismissed_${user.id}`);

    if (
      user.last_seen_changelog_version !== latestRelease.version &&
      localDismissedVersion !== latestRelease.version
    ) {
      setAutoOpen(true);
    }
  }, [user, latestRelease, manualOpen]);

  const handleDismiss = async () => {
    if (manualOpen && onManualClose) {
      onManualClose();
      return;
    }

    if (!user || !latestRelease) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("employees")
        .update({ last_seen_changelog_version: latestRelease.version })
        .eq("id", user.id);

      if (error) {
        console.error("Failed to update last_seen_changelog_version:", error);
      }
    } catch (err) {
      console.error("Error updating changelog version:", err);
    } finally {
      localStorage.setItem(`changelog_dismissed_${user.id}`, latestRelease.version);
      setIsUpdating(false);
      setAutoOpen(false);
    }
  };

  if (!latestRelease) return null;

  const isOpen = manualOpen || autoOpen;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDismiss()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md gap-0 p-0 border-border/60 shadow-xl overflow-hidden bg-background">
        <div className="flex flex-col p-6 sm:p-8">
          
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted border border-border/50 text-foreground shadow-sm shrink-0">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                What's New
              </h2>
              <p className="text-sm font-medium text-muted-foreground mt-0.5">
                Version {latestRelease.version} • {latestRelease.date}
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="mb-8">
            <h3 className="text-base font-medium text-foreground mb-4">
              {latestRelease.title}
            </h3>
            <ul className="space-y-4">
              {latestRelease.changes.map((change, index) => (
                <li key={index} className="flex gap-3 text-sm text-foreground/80 leading-relaxed">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/30" />
                  <span>{change}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <Button 
            className="w-full bg-foreground text-background hover:bg-foreground/90 font-medium h-11 shadow-sm transition-all rounded-lg" 
            onClick={handleDismiss} 
            disabled={isUpdating}
          >
            {isUpdating ? "Saving..." : "Continue to App"}
          </Button>

        </div>
      </DialogContent>
    </Dialog>
  );
}
