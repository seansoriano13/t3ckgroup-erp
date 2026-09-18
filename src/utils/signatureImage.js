/**
 * Makes near-white pixels fully transparent, so a photographed signature on
 * paper prints without a white box around the ink. Operates on a flat RGBA
 * byte array rather than a canvas ImageData object, so the algorithm is
 * unit-testable outside a browser — the canvas glue that extracts/writes
 * back the pixels lives in the capture component instead.
 *
 * A drawn (not photographed) signature is already transparent everywhere
 * the user didn't stroke, so running it through here is a no-op in practice.
 */
export function keyOutNearWhite(rgba, threshold = 200) {
  const out = Uint8ClampedArray.from(rgba)
  for (let i = 0; i < out.length; i += 4) {
    const luminance = 0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]
    if (luminance >= threshold) {
      out[i + 3] = 0
    }
  }
  return out
}
