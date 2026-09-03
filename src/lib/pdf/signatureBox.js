import { COLORS } from './adapter';

/**
 * Draws one signature box (employee, supervisor, or HR) shared by TG-11 and
 * TG-12 — both forms render this identically, so a fix to how a signature
 * renders only needs to happen here once.
 *
 * Embeds the actual signature image when one is available, falling back to
 * the signer's name only if the image can't be fetched (expired session,
 * missing file, etc.).
 */
export async function drawSignatureBox({
  page,
  docAdapter,
  fonts,
  drawText,
  drawRule,
  x,
  sigY,
  sigBoxW,
  sigBoxH,
  offsetY,
  title,
  signedName,
  signaturePath,
  timestampStr,
  isSignedOnPaper = false,
}) {
  const { sansRegular, sansBold, monoRegular } = fonts;
  const isSigned = !!signedName || isSignedOnPaper;

  if (!isSigned) {
    page.drawRectangle({
      x, y: sigY, width: sigBoxW, height: sigBoxH,
      color: COLORS.toned
    });
  }

  drawText(title, x, sigY + sigBoxH + 5, sansBold, 8, COLORS.mauve6);
  drawRule(x, sigY + sigBoxH, x + sigBoxW, sigY + sigBoxH, 1, COLORS.mauve6);

  if (!isSigned) return;

  if (isSignedOnPaper) {
    drawText('SIGNED ON PAPER', x + 5, sigY + sigBoxH - 20, sansRegular, 10, COLORS.mauve6);
    return;
  }

  const sigImage = await docAdapter.embedSignatureImage(signaturePath);
  if (sigImage) {
    const imgH = 24;
    const scale = imgH / sigImage.height;
    const imgW = Math.min(sigImage.width * scale, sigBoxW - 10);
    page.drawImage(sigImage, { x: x + 5, y: sigY + sigBoxH - imgH - 8 + offsetY, width: imgW, height: imgH });
  } else {
    drawText(signedName.toUpperCase(), x + 5, sigY + sigBoxH - 20, sansBold, 10);
  }
  const stamp = new Date(timestampStr).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
  drawText(stamp, x + 5, sigY + 10, monoRegular, 8, COLORS.mauve6);
}
