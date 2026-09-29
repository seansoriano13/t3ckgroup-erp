import * as React from "react";

// Thin <img> wrapper: no transforms, no default look. Pass className for sizing.
function Image({ alt = "", ...props }) {
  return <img data-slot="image" alt={alt} {...props} />;
}

export { Image };
