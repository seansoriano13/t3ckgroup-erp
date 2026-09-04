import { COLORS } from './adapter';
import { getOvertimeOutcome, getOvertimeHoursDisplay, isLegacySignature, formatRecordNumber } from './layout';
import { drawSignatureBox } from './signatureBox';

export async function drawTG12(page, docAdapter, record, offsetY = 0, formSettings = null) {
  const { fonts } = docAdapter;
  const { sansRegular, sansBold, monoRegular, monoBold } = fonts;

  // Base dimensions
  const width = 612; // 8.5 inches
  const height = 396; // 5.5 inches
  const margin = 36; // 0.5 inch

  const drawText = (text, x, y, font = sansRegular, size = 10, color = COLORS.black) => {
    page.drawText(text || '', { x, y: y + offsetY, size, font, color });
  };

  const drawRule = (x1, y1, x2, y2, thickness = 1, color = COLORS.mauve5) => {
    page.drawLine({
      start: { x: x1, y: y1 + offsetY },
      end: { x: x2, y: y2 + offsetY },
      thickness,
      color,
    });
  };

  // --- Masthead ---
  drawText('TG-12 OVERTIME AUTHORIZATION', margin, height - margin, sansBold, 16);
  drawText('T3CKGROUP', margin, height - margin - 14, sansBold, 10, COLORS.mauve6);
  drawText(`RECORD NO. ${formatRecordNumber(record.id)}`, width - margin - 150, height - margin, monoBold, 14);

  // --- Body ---
  const bodyTop = height - margin - 40;

  // Left Column (Details)
  drawText('EMPLOYEE NAME', margin, bodyTop, sansBold, 8, COLORS.mauve6);
  drawText(record.employee?.name?.toUpperCase() || 'UNKNOWN', margin, bodyTop - 20, sansBold, 16);
  drawRule(margin, bodyTop - 25, width / 2 - 20, bodyTop - 25, 1.5, COLORS.mauve6);

  drawText('NOTICE / PURPOSE', margin, bodyTop - 45, sansBold, 8, COLORS.mauve6);
  const noticeText = record.reason || record.purpose || record.notice_text || 'N/A';
  drawText(noticeText, margin, bodyTop - 60, sansRegular, 10);
  drawRule(margin, bodyTop - 65, width / 2 - 20, bodyTop - 65, 1.5, COLORS.mauve6);

  drawText('SUBMISSION DATE', margin, bodyTop - 85, sansBold, 8, COLORS.mauve6);
  const createdDate = record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
  drawText(createdDate, margin, bodyTop - 100, monoRegular, 10);
  drawRule(margin, bodyTop - 105, width / 2 - 20, bodyTop - 105, 1.5, COLORS.mauve6);

  // Right Column (Figures)
  const rightColX = width / 2;

  drawText('HOURS', rightColX, bodyTop, sansBold, 8, COLORS.mauve6);

  const { requested: reqHours, approved: appHours, isDifferent } = getOvertimeHoursDisplay(record);

  let hoursStr = appHours.toString();
  drawText(hoursStr, rightColX, bodyTop - 30, monoBold, 24);
  const hoursWidth = monoBold.widthOfTextAtSize(hoursStr, 24);

  // Strikethrough the requested hours only when there's a real override to
  // compare against — a null approved_hours (rejected/legacy) never gets one.
  if (isDifferent) {
    const reqStr = reqHours.toString();
    const reqX = rightColX + hoursWidth + 10;
    drawText(reqStr, reqX, bodyTop - 30, monoRegular, 16, COLORS.mauve6);
    const reqWidth = monoRegular.widthOfTextAtSize(reqStr, 16);
    drawRule(reqX - 2, bodyTop - 22, reqX + reqWidth + 2, bodyTop - 22, 1.5, COLORS.mauve6);
  }

  drawRule(rightColX, bodyTop - 35, width - margin - 80, bodyTop - 35, 1.5, COLORS.mauve6);

  drawText('OVERTIME DATE', rightColX, bodyTop - 55, sansBold, 8, COLORS.mauve6);
  const otDate = record.date ? new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
  drawText(otDate, rightColX, bodyTop - 70, monoRegular, 12);
  drawRule(rightColX, bodyTop - 75, width - margin, bodyTop - 75, 1.5, COLORS.mauve6);

  drawText('TIME WINDOW', rightColX, bodyTop - 95, sansBold, 8, COLORS.mauve6);
  const startTime = record.start_time || record.startTime || '--:--';
  const endTime = record.end_time || record.endTime || '--:--';
  drawText(`${startTime} - ${endTime}`, rightColX, bodyTop - 110, monoRegular, 12);
  drawRule(rightColX, bodyTop - 115, width - margin - 80, bodyTop - 115, 1.5, COLORS.mauve6);

  // Outcome
  drawText('OUTCOME', rightColX, bodyTop - 135, sansBold, 8, COLORS.mauve6);
  drawText(getOvertimeOutcome(record.status), rightColX, bodyTop - 150, sansBold, 12);
  drawRule(rightColX, bodyTop - 155, width - margin, bodyTop - 155, 1.5, COLORS.mauve6);

  // --- QR Code ---
  if (record.verification_token) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.t3ckgroup.com';
    const qrUrl = `${origin}/verify/${record.verification_token}`;
    const qrImage = await docAdapter.generateQR(qrUrl);
    const qrSize = 60;
    page.drawImage(qrImage, {
      x: width - margin - qrSize,
      y: height - margin - 20 - qrSize,
      width: qrSize,
      height: qrSize
    });
  }

  // --- Signatures (Bottom Band) ---
  const sigY = margin + 20;
  const sigBoxW = (width - 2 * margin) / 3 - 10;
  const sigBoxH = 60;

  const drawSigBox = (x, title, signedName, signaturePath, timestampStr, isSignedOnPaper = false) =>
    drawSignatureBox({
      page, docAdapter, fonts, drawText, drawRule,
      x, sigY, sigBoxW, sigBoxH, offsetY,
      title, signedName, signaturePath, timestampStr, isSignedOnPaper,
    });

  const isLegacy = isLegacySignature(record);

  // 1. Employee Signature
  const empSigName = record.employee_signature_timestamp ? record.employee?.name : null;
  await drawSigBox(margin, 'EMPLOYEE SIGNATURE', empSigName, record.employee_signature_version, record.employee_signature_timestamp, isLegacy);

  // 2. Supervisor (Form settings)
  const supervisorX = margin + sigBoxW + 15;
  const supervisorName = formSettings?.supervisor_name || '';
  drawText('SUPERVISOR', supervisorX, sigY + sigBoxH + 5, sansBold, 8, COLORS.mauve6);
  drawRule(supervisorX, sigY + sigBoxH, supervisorX + sigBoxW, sigY + sigBoxH, 1, COLORS.mauve6);
  if (supervisorName) {
    drawText(supervisorName.toUpperCase(), supervisorX + 5, sigY + sigBoxH - 15, sansRegular, 10);
  }

  // 3. Approved By (HR / Validator) — whoever actually processed the record.
  const hrX = supervisorX + sigBoxW + 15;
  const hrSigName = record.hr_signature_timestamp ? record.hr?.name : null;
  await drawSigBox(hrX, 'APPROVED BY', hrSigName, record.hr_signature_version, record.hr_signature_timestamp, isLegacy);
}
