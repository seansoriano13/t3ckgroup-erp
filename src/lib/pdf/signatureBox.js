import { COLORS } from './adapter';

/**
 * Draws one signature plate in the accountability band — shared by TG-11
 * and TG-12, which render this identically. Three states:
 *
 *  - 'signed': a real digital signature exists; the plate sits on bare
 *    paper and the actual signature image is embedded, with a stamp naming
 *    when and against which stored version it was signed.
 *  - 'legacy': the record predates the signing feature. Bare paper (the
 *    record is settled, not awaiting anything), the signer's name in place
 *    of an image, and a plain "Signed on paper" note.
 *  - 'wet': this role never signs digitally in this system (the immediate
 *    supervisor, an approving officer configured in Form Settings) — always
 *    a toned, blank ruled line prompting for a pen, because the system can
 *    never confirm ink was actually applied.
 */
export async function drawSignatureBox({
  docAdapter,
  fonts,
  drawText,
  drawRule,
  drawRect,
  drawImageAt,
  x,
  plateTop,
  plateW,
  plateH,
  labelY,
  block,
}) {
  const { sansBold, monoRegular, serifMedium } = fonts;
  const isToned = block.state === 'wet';
  const plateBottom = plateTop - plateH;

  if (isToned) {
    drawRect(x, plateBottom, plateW, plateH, COLORS.well);
  }

  drawText(block.role.toUpperCase(), x, labelY, sansBold, 5.6, COLORS.ink3, 0.12);
  drawRule(x, plateBottom, x + plateW, plateBottom, 1, COLORS.rule);

  let sigImage = null;
  if (block.state === 'signed') {
    sigImage = await docAdapter.embedSignatureImage(block.signaturePath);
  }

  if (sigImage) {
    const imgH = Math.min(18, plateH - 3);
    const scale = imgH / sigImage.height;
    const imgW = Math.min(sigImage.width * scale, plateW - 8);
    drawImageAt(sigImage, x + (plateW - imgW) / 2, plateBottom + (plateH - imgH) / 2 + 1.5, imgW, imgH);
  }

  const whoY = plateBottom - 11;
  drawText(block.who, x, whoY, serifMedium, 10, COLORS.ink, -0.006);
  drawText(block.title.toUpperCase(), x, whoY - 8, sansBold, 5.6, COLORS.ink3, 0.08);

  if (block.state === 'signed' && block.stamp) {
    drawText(block.stamp, x, whoY - 17, monoRegular, 5.3, COLORS.ink2);
  } else if (block.state === 'legacy') {
    drawText('Signed on paper', x, whoY - 17, monoRegular, 5.3, COLORS.ink3);
  } else {
    drawText('SIGNATURE REQUIRED', x, whoY - 17, monoRegular, 5.3, COLORS.ink3, 0.09);
  }
}
