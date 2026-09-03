import { COLORS } from './adapter';

/**
 * Shared low-level draw helpers for a half-sheet page. `drawText` supports a
 * `tracking` em value (pdf-lib has no native letter-spacing) by advancing
 * each glyph manually — this design's tracked-caps labels are load-bearing,
 * not decorative, so dropping tracking would lose the thing that makes a
 * field key read as a key rather than a second value.
 */
export function createDrawHelpers(page, offsetY, defaultFont) {
  function drawText(text, x, y, font = defaultFont, size = 10, color = COLORS.ink, tracking = 0) {
    const str = text == null ? '' : String(text);
    if (!str) return 0;
    if (!tracking) {
      page.drawText(str, { x, y: y + offsetY, size, font, color });
      return font.widthOfTextAtSize(str, size);
    }
    let cursor = x;
    for (const ch of str) {
      page.drawText(ch, { x: cursor, y: y + offsetY, size, font, color });
      cursor += font.widthOfTextAtSize(ch, size) + tracking * size;
    }
    return cursor - x;
  }

  function measureTracked(text, font, size, tracking = 0) {
    const str = text == null ? '' : String(text);
    if (!tracking) return font.widthOfTextAtSize(str, size);
    let w = 0;
    for (const ch of str) w += font.widthOfTextAtSize(ch, size) + tracking * size;
    return w - tracking * size;
  }

  function drawRule(x1, y1, x2, y2, thickness = 1, color = COLORS.rule) {
    page.drawLine({
      start: { x: x1, y: y1 + offsetY },
      end: { x: x2, y: y2 + offsetY },
      thickness,
      color,
    });
  }

  /** `y` is the rectangle's bottom edge, matching pdf-lib's own drawRectangle convention. */
  function drawRect(x, y, width, height, color, options = {}) {
    const rectOpts = { x, y: y + offsetY, width, height, ...options };
    if (color) rectOpts.color = color;
    page.drawRectangle(rectOpts);
  }

  /** `y` is the image's bottom edge. */
  function drawImageAt(image, x, y, width, height) {
    page.drawImage(image, { x, y: y + offsetY, width, height });
  }

  /** Right-aligns tracked text at `xEnd`. */
  function drawTextRight(text, xEnd, y, font, size, color, tracking = 0) {
    const w = measureTracked(text, font, size, tracking);
    drawText(text, xEnd - w, y, font, size, color, tracking);
    return w;
  }

  /** Word-wraps `text` into `maxWidth`, drawing each line with `lineHeight` spacing downward from `y` (top). Returns the bottom y reached. */
  function drawParagraph(text, x, y, maxWidth, font, size, color, lineHeight) {
    const words = (text || '').split(/\s+/).filter(Boolean);
    let line = '';
    let cursorY = y;
    const flush = () => {
      if (line) drawText(line, x, cursorY, font, size, color);
      cursorY -= lineHeight;
    };
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        flush();
        line = word;
      } else {
        line = candidate;
      }
    }
    flush();
    return cursorY;
  }

  return { drawText, drawRule, drawRect, drawImageAt, drawTextRight, measureTracked, drawParagraph };
}
