import { useImperativeHandle, useRef } from "react";

import { Button } from "@/components/ui/button";

/**
 * Owns the hidden file input and its trigger. With `children` it renders a
 * Button that opens the picker; without, only the hidden input, opened through
 * the ref (`ref.current.open()`) from a trigger elsewhere.
 */
function FileInput({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  children,
  ref,
  variant = "outline",
  size,
  className,
  ...buttonProps
}) {
  const inputRef = useRef(null);

  useImperativeHandle(ref, () => ({
    open: () => {
      if (!disabled) inputRef.current?.click();
    },
  }));

  const handleChange = (e) => {
    const files = Array.from(e.target.files ?? []);
    // Reset so the same file can be picked again after a cancel.
    e.target.value = "";
    if (files.length > 0) onFiles?.(files);
  };

  return (
    <>
      <input
        ref={inputRef}
        data-slot="file-input"
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        className="hidden"
      />
      {children != null && (
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          className={className}
          onClick={() => inputRef.current?.click()}
          {...buttonProps}>
          {children}
        </Button>
      )}
    </>
  );
}

export { FileInput }
