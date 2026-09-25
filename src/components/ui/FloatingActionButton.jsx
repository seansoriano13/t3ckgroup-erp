import { cn } from "@/lib/utils";

/**
 * A primary action that floats above a scrolling surface instead of riding in
 * the page header.
 *
 * Bottom-right, because it is the one corner of this app nothing else claims.
 * The top-right is permanently spoken for by the environment ribbon
 * (`StagingBanner`, fixed top-0 right-0), which is what was slicing through the
 * SORs register's Register button; the top-left belongs to the SideNav's mobile
 * trigger; the top-centre to `FloatingMonthPicker`. Bottom-right also sits
 * outside the left-to-right, top-to-bottom reading path, so it never covers the
 * first row of the thing you came to read, and it is where the hand already
 * rests on a tablet.
 *
 * The label always shows. A bare "+" is a guess, and a register that does not
 * say what the button registers has not shipped the feature.
 */
const POSITIONS = {
  "bottom-right": "bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-6",
  "bottom-left": "bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-6",
};

export default function FloatingActionButton({
  icon: Icon,
  label,
  onClick,
  position = "bottom-right",
  className,
  ...props
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        // z-30 keeps it above the register body but below the SideNav, modals
        // and the environment ribbon, all of which sit at z-50 and up.
        "fixed z-30 flex items-center gap-2 rounded-full bg-primary py-3.5 pl-4 pr-5",
        "text-[13px] font-bold text-primary-foreground",
        "shadow-[0_10px_30px_-8px_rgb(0_0_0/0.45)]",
        "transition-[transform,box-shadow,background-color] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-[0_16px_40px_-10px_rgb(0_0_0/0.55)]",
        "active:translate-y-0 active:duration-75",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        POSITIONS[position],
        className,
      )}
      {...props}
    >
      {Icon && <Icon size={16} strokeWidth={2.5} className="shrink-0" />}
      {label}
    </button>
  );
}
