import { CheckCircle2, AlertCircle, Info, AlertTriangle } from "lucide-react";
import { toast, resolveValue } from "react-hot-toast";
import Spinner from "@/components/ui/Spinner";

export function CustomToast({ 
  t, 
  title, 
  description, 
  variant = "default", 
  onConfirm, 
  onCancel, 
  confirmText = "Confirm", 
  cancelText = "Cancel" 
}) {
  // Try to infer variant from t.type if not explicitly passed
  let resolvedVariant = variant;
  if (!resolvedVariant || resolvedVariant === "default") {
    if (t.type === "success") resolvedVariant = "success";
    else if (t.type === "error") resolvedVariant = "error";
    else if (t.type === "loading") resolvedVariant = "loading";
    else resolvedVariant = "info";
  }

  // Derive message from t.message
  const content = resolveValue(t.message, t);
  let displayTitle = title;
  let displayDescription = description || content;

  // Provide sensible default titles
  if (!displayTitle) {
    if (resolvedVariant === "success") displayTitle = "Success";
    else if (resolvedVariant === "error") displayTitle = "Error";
    else if (resolvedVariant === "loading") displayTitle = "Processing...";
    else if (resolvedVariant === "info") displayTitle = "Information";
    else if (resolvedVariant === "confirm") displayTitle = "Confirm Action";
  }

  const configs = {
    success: {
      icon: CheckCircle2,
      color: "text-green-9",
      bg: "bg-green-9/10",
      border: "border-green-9/20",
    },
    error: {
      icon: AlertCircle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      border: "border-red-500/20",
    },
    loading: {
      color: "text-violet-9",
      bg: "bg-primary/10",
      border: "border-violet-9/20",
      spin: true,
    },
    info: {
      icon: Info,
      color: "text-violet-9",
      bg: "bg-primary/10",
      border: "border-violet-9/20",
    },
    confirm: {
      icon: AlertTriangle,
      color: "text-destructive",
      bg: "bg-destructive/10",
      border: "border-red-600/20",
    }
  };

  const config = configs[resolvedVariant] || configs.info;
  const Icon = config.icon;

  return (
    <div
      className={`${
        t.visible ? "animate-in fade-in slide-in-from-bottom-5" : "animate-out fade-out slide-out-to-bottom-5 opacity-0"
      } bg-card shadow-2xl rounded-2xl p-4 flex flex-col gap-4 min-w-[320px] max-w-[420px] pointer-events-auto border border-border transition-all duration-300`}
    >
      <div className="flex items-start gap-4">
        <div className={`${config.bg} p-2.5 rounded-xl border ${config.border} shrink-0`}>
          {config.spin ? (
            <Spinner size="sm" />
          ) : (
            <Icon className={config.color} size={24} />
          )}
        </div>
        <div className="flex flex-col justify-center min-h-[44px]">
          <span className="font-extrabold text-[15px] text-foreground tracking-tight">
            {displayTitle}
          </span>
          {displayDescription && (
            <p className="text-xs font-bold text-muted-foreground leading-relaxed mt-0.5">
              {displayDescription}
            </p>
          )}
        </div>
      </div>
      
      {resolvedVariant === "confirm" && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            className="px-4 py-2 rounded-xl text-xs font-black text-muted-foreground hover:bg-muted/80 transition-all uppercase tracking-widest"
            onClick={() => {
              if (onCancel) onCancel();
              toast.dismiss(t.id);
            }}
          >
            {cancelText}
          </button>
          <button
            className="bg-destructive hover:bg-red-700 text-primary-foreground px-5 py-2.5 rounded-xl text-xs font-black transition-all shadow-[0_8px_16px_-4px_rgba(220,38,38,0.3)] uppercase tracking-widest flex items-center gap-2"
            onClick={() => {
              if (onConfirm) onConfirm();
              toast.dismiss(t.id);
            }}
          >
            {confirmText}
          </button>
        </div>
      )}
    </div>
  );
}

// Global utility for triggering delete confirmations
// eslint-disable-next-line react-refresh/only-export-components
export const confirmDeleteToast = (title, description, onConfirm) => {
  toast.custom(
    (t) => (
      <CustomToast
        t={t}
        variant="confirm"
        title={title}
        description={description}
        onConfirm={onConfirm}
        confirmText="Confirm Deletion"
      />
    ),
    { duration: Infinity, id: "delete-confirm" }
  );
};

// Global utility for triggering generic action confirmations
export const confirmActionToast = (title, description, confirmText, actionType, onConfirm) => {
  toast.custom(
    (t) => (
      <CustomToast
        t={t}
        variant="confirm"
        title={title}
        description={description}
        onConfirm={onConfirm}
        confirmText={confirmText}
      />
    ),
    { duration: Infinity, id: `action-confirm-${Date.now()}` }
  );
};
