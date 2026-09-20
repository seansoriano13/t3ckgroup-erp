import * as React from "react"

import { Button } from "@/components/ui/button"

/**
 * The file picker Primitive. It owns the hidden <input type="file"> and, when
 * given children, the button that opens it.
 *
 *   <FileInput accept="image/*" multiple onFiles={(files) => upload(files)}>
 *     <Paperclip /> Attach
 *   </FileInput>
 *
 * With no children it renders only the hidden input, for a trigger that lives
 * elsewhere: pass a `ref` and call `ref.current.click()` to open the picker.
 *
 * `onFiles` receives the chosen files as an array, once per pick. The input is
 * cleared afterwards, so picking the same file again fires again.
 */
function FileInput({
  ref,
  accept,
  multiple,
  disabled,
  title,
  onFiles,
  children,
  variant = "outline",
  size = "sm",
  className,
  ...props
}) {
  const inputRef = React.useRef(null)

  React.useImperativeHandle(ref, () => ({
    click: () => inputRef.current?.click(),
  }), [])

  const handleChange = (event) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length > 0) onFiles?.(files)
  }

  return (
    <>
      <input
        ref={inputRef}
        data-slot="file-input"
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={handleChange}
        tabIndex={-1}
        aria-hidden={children == null ? undefined : true}
        {...props}
      />
      {children != null && (
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={disabled}
          title={title}
          className={className}
          onClick={() => inputRef.current?.click()}
        >
          {children}
        </Button>
      )}
    </>
  )
}

export { FileInput }
