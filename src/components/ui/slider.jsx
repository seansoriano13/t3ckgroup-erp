import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

// A single-value slider. Replaces <input type="range">.
//   <Slider min={1} max={3} step={0.1} value={zoom} onValueChange={setZoom} aria-label="Zoom" />
function Slider({ className, "aria-label": ariaLabel, ...props }) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("relative flex w-full touch-none items-center select-none data-disabled:opacity-50", className)} {...props}>
      <SliderPrimitive.Control className="flex h-5 w-full items-center">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={ariaLabel}
            className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider }
