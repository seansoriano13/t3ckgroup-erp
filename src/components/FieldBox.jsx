export const FieldBox = ({ label, isEditing, noBorder = false, children }) => (
  <div className="flex flex-col gap-1.5 w-full">
    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest pl-1">
      {label}
    </label>
    <div
      className={`min-h-[38px] flex items-center w-full bg-card border ${isEditing && !noBorder ? "border-border shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/10" : "border-transparent"} rounded-lg transition-all`}
    >
      {children}
    </div>
  </div>
);
