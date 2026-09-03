import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';
import { signatureService } from '../../services/signatureService';

// Colors based on specs
export const COLORS = {
  black: rgb(0, 0, 0),
  mauve6: rgb(0.5, 0.4, 0.5), // Approximate Mauve 6
  mauve5: rgb(0.6, 0.5, 0.6), // Approximate Mauve 5
  toned: rgb(0.95, 0.93, 0.95), // Light mauve/toned for pending signature
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
    regularFontBytes,
    boldFontBytes,
    monoRegularFontBytes,
    monoBoldFontBytes,
  ] = await Promise.all([
    fetchFont('Geist-Regular.ttf'),
    fetchFont('Geist-Bold.ttf'),
    fetchFont('GeistMono-Regular.ttf'),
    fetchFont('GeistMono-Bold.ttf'),
  ]);

  const [sansRegular, sansBold, monoRegular, monoBold] = await Promise.all([
    doc.embedFont(regularFontBytes),
    doc.embedFont(boldFontBytes),
    doc.embedFont(monoRegularFontBytes),
    doc.embedFont(monoBoldFontBytes)
  ]);
  
  // pdf-lib embeds PNG/JPG, not SVG — the mono logo mark's actual rendering
  // (rasterizing tg-logo-mono.svg or otherwise) is tracked separately and out
  // of scope here (ticket #70); this adapter deliberately embeds no logo.

  return {
    doc,
    fonts: {
      sansRegular,
      sansBold,
      monoRegular,
      monoBold,
    },
    /**
     * Add a half-sheet page (8.5 x 5.5 landscape)
     */
    addHalfPage() {
      // 8.5 x 5.5 inches in points (72 points per inch)
      const width = 8.5 * 72; // 612
      const height = 5.5 * 72; // 396
      const page = doc.addPage([width, height]);
      return page;
    },
    
    async generateQR(text) {
      // qrcode returns a data URL for PNG by default
      const dataUrl = await QRCode.toDataURL(text, { margin: 0, scale: 4, color: { dark: '#000000', light: '#FFFFFF' } });
      const pngImageBytes = await fetch(dataUrl).then((res) => res.arrayBuffer());
      return await doc.embedPng(pngImageBytes);
    },
    
    /**
     * Embeds a stored signature PNG (by its storage path) so the printed
     * form shows the actual signature image, not the signer's name in bold
     * as a stand-in. Returns null on any failure (missing path, expired
     * bucket access, non-PNG content) so a signature problem degrades to no
     * image rather than failing the whole print.
     */
    async embedSignatureImage(signaturePath) {
      if (!signaturePath) return null;
      try {
        const url = await signatureService.getSignatureUrl(signaturePath);
        if (!url) return null;
        const response = await fetch(url);
        if (!response.ok) return null;
        const bytes = await response.arrayBuffer();
        return await doc.embedPng(bytes);
      } catch {
        return null;
      }
    },

    async save() {
      return await doc.save();
    }
  };
}
