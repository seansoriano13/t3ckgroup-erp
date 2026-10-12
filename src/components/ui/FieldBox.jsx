import { Children, cloneElement, isValidElement, useId } from "react";
import { cn } from "@/lib/utils";
import { CAPTION_BASE } from "@/lib/captionStyle";

const CAPTION = `flex items-center gap-1.5 ${CAPTION_BASE} text-muted-foreground tracking-widest`;

/**
 * The form-field Primitive: a caption label, optionally with its control.
 *
 * - default: caption above a bordered control box (`isEditing` / `noBorder`).
 * - `bare`: caption above the children, no box (children bring their own look).
 * - no children: the caption only, for a control laid out elsewhere. Pass
 *   `htmlFor` to associate it.
 * - `inline`: the label wraps its children, for checkbox / switch rows.
 *
 * With children, the label is associated with a lone child element (id
 * injected unless the child has one, or `htmlFor` says otherwise).
 * `className` is for layout (margins, width), not typography.
 */
export const FieldBox = ({
  label,
  isEditing,
  noBorder = false,
  bare = false,
  inline = false,
  htmlFor,
  className,
  children,
}) => {
  const generatedId = useId();

  if (inline) {
    return (
      <label htmlFor={htmlFor} className={cn("flex items-center gap-2 cursor-pointer", className)}>
        {children}
      </label>
    );
  }

  if (children === undefined || children === null || children === false) {
    return (
      <label htmlFor={htmlFor} className={cn(CAPTION, className)}>
        {label}
      </label>
    );
  }

  const only = Children.count(children) === 1 ? Children.toArray(children)[0] : null;
  const injectable = isValidElement(only) && !htmlFor && !only.props.id;
  const controlId = htmlFor ?? (isValidElement(only) ? only.props.id : undefined) ?? generatedId;
  const content = injectable ? cloneElement(only, { id: controlId }) : children;
  const labelFor = htmlFor ?? (injectable || isValidElement(only) ? controlId : undefined);

  return (
    <div className={cn("flex flex-col gap-1.5 w-full", className)}>
      <label htmlFor={labelFor} className={cn(CAPTION, "pl-1")}>
        {label}
      </label>
      {bare ? (
        content
      ) : (
        <div
          className={`min-h-[38px] flex items-center w-full bg-card border ${isEditing && !noBorder ? "border-border shadow-sm focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/10" : "border-transparent"} rounded-lg transition-all`}
        >
          {content}
        </div>
      )}
    </div>
  );
};
