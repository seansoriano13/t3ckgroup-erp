import { COLORS } from './adapter';
import { resolveLeaveCategory, getInclusiveDates, getDayCount, isLateFiling, isLegacySignature, formatRecordNumber } from './layout';
import { drawSignatureBox } from './signatureBox';

export async function drawTG11(page, docAdapter, record, offsetY = 0, formSettings = null) {
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
  drawText('TG-11 LEAVE / OFFSET FORM', margin, height - margin, sansBold, 16);
  drawText('T3CKGROUP', margin, height - margin - 14, sansBold, 10, COLORS.mauve6);
  drawText(`RECORD NO. ${formatRecordNumber(record.id)}`, width - margin - 150, height - margin, monoBold, 14);

  // --- Body ---
  const bodyTop = height - margin - 40;

  // Left Column (Employee Details)
  drawText('EMPLOYEE NAME', margin, bodyTop, sansBold, 8, COLORS.mauve6);
  drawText(record.employee?.name?.toUpperCase() || 'UNKNOWN', margin, bodyTop - 20, sansBold, 16);
  drawRule(margin, bodyTop - 25, width / 2 - 20, bodyTop - 25, 1.5, COLORS.mauve6);

  drawText('LEAVE CATEGORY', margin, bodyTop - 45, sansBold, 8, COLORS.mauve6);
  drawText(resolveLeaveCategory(record).toUpperCase(), margin, bodyTop - 60, sansRegular, 12);
  drawRule(margin, bodyTop - 65, width / 2 - 20, bodyTop - 65, 1.5, COLORS.mauve6);

  const lateStr = isLateFiling(record) ? '(LATE FILING)' : '';
  drawText('SUBMISSION DATE', margin, bodyTop - 85, sansBold, 8, COLORS.mauve6);
  const createdDate = record.created_at ? new Date(record.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';
  drawText(`${createdDate} ${lateStr}`, margin, bodyTop - 100, monoRegular, 10);
  drawRule(margin, bodyTop - 105, width / 2 - 20, bodyTop - 105, 1.5, COLORS.mauve6);

  drawText('Must be filed before leave commences, or immediately upon return for emergency/sick leaves.', margin, bodyTop - 122, sansRegular, 7, COLORS.mauve6);

  // Right Column (Figures)
  const rightColX = width / 2;

  drawText('HOURS DEDUCTED', rightColX, bodyTop, sansBold, 8, COLORS.mauve6);
  drawText(record.hours?.toString() || '0', rightColX, bodyTop - 30, monoBold, 24);
  drawRule(rightColX, bodyTop - 35, width - margin - 80, bodyTop - 35, 1.5, COLORS.mauve6);

  drawText('DATES', rightColX, bodyTop - 55, sansBold, 8, COLORS.mauve6);
  drawText(getInclusiveDates(record), rightColX, bodyTop - 70, monoRegular, 12);
  drawRule(rightColX, bodyTop - 75, width - margin, bodyTop - 75, 1.5, COLORS.mauve6);

  drawText('DAY COUNT', rightColX, bodyTop - 100, sansBold, 8, COLORS.mauve6);
  drawText(getDayCount(record).toString(), rightColX, bodyTop - 115, monoRegular, 12);
  drawRule(rightColX, bodyTop - 120, rightColX + 80, bodyTop - 120, 1.5, COLORS.mauve6);

  // The balance printed here is a snapshot taken immediately after the
  // approval that's being printed moved it (see offsetService/silService's
  // handleXDecision), never the employee's current live balance — a form
  // printed later must still read the balance as of the decision it documents.
  let balanceText = 'N/A';
  if (record.approval_credits_snapshot !== null && record.approval_credits_snapshot !== undefined) {
    balanceText = record.approval_credits_snapshot.toString();
  }

  drawText('REMAINING BALANCE', rightColX + 100, bodyTop - 100, sansBold, 8, COLORS.mauve6);
  drawText(balanceText, rightColX + 100, bodyTop - 115, monoRegular, 12);
  drawRule(rightColX + 100, bodyTop - 120, width - margin, bodyTop - 120, 1.5, COLORS.mauve6);

  // --- QR Code ---
  if (record.verification_token) {
    // Assuming window is available in the environment this runs in
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

  // 2. Supervisor (Always blank ruled line with printed name from settings if available)
  const supervisorX = margin + sigBoxW + 15;
  const supervisorName = formSettings?.supervisor_name || '';
  drawText('SUPERVISOR', supervisorX, sigY + sigBoxH + 5, sansBold, 8, COLORS.mauve6);
  drawRule(supervisorX, sigY + sigBoxH, supervisorX + sigBoxW, sigY + sigBoxH, 1, COLORS.mauve6);
  if (supervisorName) {
    drawText(supervisorName.toUpperCase(), supervisorX + 5, sigY + sigBoxH - 15, sansRegular, 10);
  }

  // 3. HR / Validator Signature — whoever actually processed the record
  // (hr_processed_by), never the pre-printed form-settings name.
  const hrX = supervisorX + sigBoxW + 15;
  const hrSigName = record.hr_signature_timestamp ? record.hr?.name : null;
  await drawSigBox(hrX, 'HR OFFICER', hrSigName, record.hr_signature_version, record.hr_signature_timestamp, isLegacy);
}
