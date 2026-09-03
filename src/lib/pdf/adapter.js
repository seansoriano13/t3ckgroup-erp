import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { signatureService } from '../../services/signatureService';
import logoMonoPng from '../../assets/pdf/tg-logo-mono.png';
import { generatePDFEndpoint } from './api';

function toHex(c) {
  if (!c || c.type !== 'RGB') return '#000000';
  const r = Math.round(c.red * 255).toString(16).padStart(2, '0');
  const g = Math.round(c.green * 255).toString(16).padStart(2, '0');
  const b = Math.round(c.blue * 255).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

function buildHtml(pages) {
  const pagesHtml = pages.map(p => `
    <div class="page" style="width: ${p.width}pt; height: ${p.height}pt; position: relative; overflow: hidden; page-break-after: always; background: white;">
      ${p.elements.join('\n')}
    </div>
  `).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;700&family=Geist+Mono:wght@400;700&family=Spectral:ital,wght@0,400;0,500;0,600;1,400&display=swap');
body { margin: 0; padding: 0; box-sizing: border-box; background: white; }
</style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;
}

/**
 * Warm-neutral monochrome ink ramp — four densities, no fifth. Matches the
 * approved TG-11/TG-12 design mockup exactly; the QR stays true black
 * because scanners need the contrast, never the ink ramp's near-black.
 */
export const COLORS = {
  ink: rgb(0x1B / 255, 0x16 / 255, 0x20 / 255),
  soft: rgb(0x6F / 255, 0x6A / 255, 0x75 / 255),
  faint: rgb(0x94 / 255, 0x90 / 255, 0x9B / 255),
  rule: rgb(0xC9 / 255, 0xC4 / 255, 0xCE / 255),
  hair: rgb(0xE4 / 255, 0xE1 / 255, 0xE8 / 255),
  well: rgb(0xF1 / 255, 0xEF / 255, 0xF3 / 255),
  black: rgb(0, 0, 0),
  white: rgb(1, 1, 1),
};

export async function createPdfAdapter() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  // Note: we fetch fonts from the public folder during runtime.
  // In a browser context, we fetch them from the URL root.
  const fetchFont = async (name) => {
    const response = await fetch(`/fonts/${name}`);
    if (!response.ok) throw new Error(`Could not load font ${name}`);
    return await response.arrayBuffer();
  };

  const [
    sansRegularBytes,
    sansBoldBytes,
    monoRegularBytes,
    monoBoldBytes,
    serifRegularBytes,
    serifMediumBytes,
    serifSemiBoldBytes,
    serifItalicBytes,
  ] = await Promise.all([
    fetchFont('Geist-Regular.ttf'),
    fetchFont('Geist-Bold.ttf'),
    fetchFont('GeistMono-Regular.ttf'),
    fetchFont('GeistMono-Bold.ttf'),
    fetchFont('Spectral-Regular.ttf'),
    fetchFont('Spectral-Medium.ttf'),
    fetchFont('Spectral-SemiBold.ttf'),
    fetchFont('Spectral-Italic.ttf'),
  ]);

  const [
    sansRegular, sansBold, monoRegular, monoBold,
    serifRegular, serifMedium, serifSemiBold, serifItalic,
  ] = await Promise.all([
    doc.embedFont(sansRegularBytes),
    doc.embedFont(sansBoldBytes),
    doc.embedFont(monoRegularBytes),
    doc.embedFont(monoBoldBytes),
    doc.embedFont(serifRegularBytes),
    doc.embedFont(serifMediumBytes),
    doc.embedFont(serifSemiBoldBytes),
    doc.embedFont(serifItalicBytes),
  ]);

  // The mono mark: currentColor SVG rasterized once at build/asset time
  // (src/assets/pdf/tg-logo-mono.png) since pdf-lib embeds PNG/JPG, not SVG.
  const logoBytes = await fetch(logoMonoPng).then((r) => r.arrayBuffer());
  const logoBase64 = 'data:image/png;base64,' + btoa(new Uint8Array(logoBytes).reduce((data, byte) => data + String.fromCharCode(byte), ''));

  const htmlPages = [];

  return {
    doc: {
      addPage([width, height]) {
        const elements = [];
        
        const page = {
          width, height,
          elements,
          
          drawText(text, { x, y, size, font, color }) {
            const hex = toHex(color);
            elements.push(`<div style="position:absolute; left:${x}pt; bottom:${y}pt; font-family:${font.cssName}; font-weight:${font.weight}; font-style:${font.style||'normal'}; font-size:${size}pt; color:${hex}; white-space:pre; line-height:1; transform: translateY(18%);">${escapeHTML(text)}</div>`);
          },
          drawLine({ start, end, thickness, color, dashArray }) {
            const hex = toHex(color);
            const isHorizontal = start.y === end.y;
            const isVertical = start.x === end.x;
            let borderStyle = dashArray ? 'dashed' : 'solid';
            if (isHorizontal) {
              const w = Math.abs(end.x - start.x);
              const minX = Math.min(start.x, end.x);
              elements.push(`<div style="position:absolute; left:${minX}pt; bottom:${start.y}pt; width:${w}pt; height:0; border-bottom:${thickness}pt ${borderStyle} ${hex}; transform:translateY(${thickness/2}pt);"></div>`);
            } else if (isVertical) {
              const h = Math.abs(end.y - start.y);
              const minY = Math.min(start.y, end.y);
              elements.push(`<div style="position:absolute; left:${start.x}pt; bottom:${minY}pt; width:0; height:${h}pt; border-left:${thickness}pt ${borderStyle} ${hex}; transform:translateX(-${thickness/2}pt);"></div>`);
            }
          },
          drawRectangle({ x, y, width, height, color, borderColor, borderWidth }) {
            let css = `position:absolute; left:${x}pt; bottom:${y}pt; width:${width}pt; height:${height}pt; box-sizing: border-box;`;
            if (color) css += ` background-color:${toHex(color)};`;
            if (borderColor && borderWidth) css += ` border:${borderWidth}pt solid ${toHex(borderColor)};`;
            elements.push(`<div style="${css}"></div>`);
          },
          drawImage(image, { x, y, width, height }) {
            elements.push(`<img src="${image.src}" style="position:absolute; left:${x}pt; bottom:${y}pt; width:${width}pt; height:${height}pt;" />`);
          }
        };
        htmlPages.push(page);
        return page;
      }
    },
    fonts: {
      sansRegular: { ...sansRegular, cssName: "'Geist', sans-serif", weight: 400 },
      sansBold: { ...sansBold, cssName: "'Geist', sans-serif", weight: 700 },
      monoRegular: { ...monoRegular, cssName: "'Geist Mono', monospace", weight: 400 },
      monoBold: { ...monoBold, cssName: "'Geist Mono', monospace", weight: 700 },
      serifRegular: { ...serifRegular, cssName: "'Spectral', serif", weight: 400, style: 'normal' },
      serifMedium: { ...serifMedium, cssName: "'Spectral', serif", weight: 500, style: 'normal' },
      serifSemiBold: { ...serifSemiBold, cssName: "'Spectral', serif", weight: 600, style: 'normal' },
      serifItalic: { ...serifItalic, cssName: "'Spectral', serif", weight: 400, style: 'italic' },
    },
    logoImage: { src: logoBase64 },
    
    addHalfPage() {
      // Not actually used in printer.js but kept for compatibility
      const width = 8.5 * 72; // 612
      const height = 5.5 * 72; // 396
      return this.doc.addPage([width, height]);
    },

    async generateQR(text) {
      const dataUrl = await QRCode.toDataURL(text, { margin: 0, scale: 4, color: { dark: '#000000', light: '#FFFFFF' } });
      return { src: dataUrl };
    },

    async embedSignatureImage(signaturePath) {
      if (!signaturePath) return null;
      try {
        const url = await signatureService.getSignatureUrl(signaturePath);
        if (!url) return null;
        const response = await fetch(url);
        if (!response.ok) return null;
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
             const img = new Image();
             img.onload = () => resolve({ src: img.src, width: img.naturalWidth, height: img.naturalHeight });
             img.onerror = reject;
             img.src = reader.result;
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } catch {
        return null;
      }
    },

    async save() {
      const htmlContent = buildHtml(htmlPages);
      return await generatePDFEndpoint(htmlContent);
    }
  };
}
