import { cn } from "@/lib/utils"

// A thin <img> for pictures that are neither a person (Avatar) nor an upload
// (ImageAttachment). It adds no transforms and no URL rewriting: src goes to
// the browser as given. Always pass `alt` ("" when purely decorative).
function Image({ className, alt, ...props }) {
  return (
    <img
      data-slot="image"
      decoding="async"
      alt={alt}
      className={cn(className)}
      {...props} />
  );
}

export { Image }
