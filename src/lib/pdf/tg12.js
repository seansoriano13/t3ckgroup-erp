import { COLORS } from './adapter';
import { createDrawHelpers } from './canvas';
import { drawSignatureBox } from './signatureBox';
import { buildTG12ViewModel } from './formViewModel';

const PAGE_W = 612;
const PAGE_H = 396;

export async function drawTG12(page, docAdapter, record, offsetY = 0, formSettings = null) {
  const { fonts, logoImage } = docAdapter;
  const { sansRegular, sansBold, monoRegular, monoBold, serifMedium } = fonts;
  const { drawText, drawRule, drawRect, drawImageAt, drawTextRight, drawParagraph } = createDrawHelpers(page, offsetY, sansRegular);

  const d = buildTG12ViewModel(record, formSettings);

  // 1 — MASTHEAD
  const mastTop = PAGE_H - 21;
  const mastRuleY = mastTop - 28.5; // height 20.25 + 8.25 bottom pad
  
  drawImageAt(logoImage, 22.5, mastTop - 20.25, 24, 20.25);
  
  const orgX = 22.5 + 24 + 10.5; 
  drawText('T3CKGROUP', orgX, mastTop - 6.5, sansBold, 7.125, COLORS.soft, 0.13); 
  drawText('HUMAN RESOURCES', orgX, mastTop - 15, sansRegular, 5.625, COLORS.faint, 0.2);
  
  const titleX = orgX + 110; 
  drawText((d.kind || '').toUpperCase(), titleX, mastTop - 9.5, sansBold, 12, COLORS.ink, 0.1);
  
  const formCode = 'TG-12';
  drawTextRight(formCode, 612 - 22.5, mastTop - 10, monoBold, 11.25, COLORS.ink, 0.04);
  drawTextRight(d.recordNo || '', 612 - 22.5, mastTop - 19, monoRegular, 6.75, COLORS.faint, 0.08);

  drawRule(22.5, mastRuleY, 612 - 22.5, mastRuleY, 0.75, COLORS.rule);

  // 2 — BODY
  const bodyTop = mastRuleY - 15; 
  
  // 02 Subject
  const subjK_Y = bodyTop - 5.6; 
  drawText('EMPLOYEE', 22.5, subjK_Y, sansRegular, 5.625, COLORS.faint, 0.13);
  const subjN_Y = subjK_Y - 20; 
  drawText(d.name, 22.5, subjN_Y, sansBold, 15.75, COLORS.ink, -0.022); 
  const subjM_Y = subjN_Y - 14;
  drawText(d.meta, 22.5, subjM_Y, sansRegular, 7.875, COLORS.soft); 
  
  const subjRuleY = subjM_Y - 12; 
  drawRule(22.5, subjRuleY, 22.5 + 361.5, subjRuleY, 0.5, COLORS.hair);

  // 04 Fields
  const fldTop = subjRuleY - 12; 
  const colW = 111.5;
  const colGap = 13.5;
  const rowGap = 12; 
  const fieldH = 21; 
  
  if (d.fields) {
    d.fields.forEach((f, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const fx = 22.5 + col * (colW + colGap);
      const ry = fldTop - row * (fieldH + rowGap);
      drawText((f.k || '').toUpperCase(), fx, ry - 5.6, sansRegular, 5.625, COLORS.faint, 0.13);
      
      const isMono = /\d/.test(f.v) || (f.v && String(f.v).includes('Aug')); 
      const fFont = isMono ? monoRegular : sansBold; 
      drawTextWrapped(f.v, fx, ry - 14, colW, fFont, 9.375, COLORS.ink, drawText);
      if (f.x) drawText(f.x, fx, ry - 22, sansRegular, 7.125, COLORS.soft);
    });
  }

  // 07 Prose
  const gridRows = Math.ceil((d.fields || []).length / 3);
  const proseTop = fldTop - gridRows * (fieldH + rowGap) + 8;
  drawRule(22.5, proseTop, 22.5 + 361.5, proseTop, 0.5, COLORS.hair);
  if (d.remK) {
    drawText(d.remK.toUpperCase(), 22.5, proseTop - 11, sansRegular, 5.625, COLORS.faint, 0.13);
  }
  if (d.rem) {
    drawParagraph(d.rem, 22.5, proseTop - 23, 361.5, sansRegular, 8.625, COLORS.ink, 11);
  }

  // 03 Anchor (Right Rail)
  const rightX = 402;
  const rightW = 187.5;
  const boxTop = bodyTop;
  const boxH = d.requestedHours ? 96 : 60; 
  drawRect(rightX, boxTop - boxH, rightW, boxH, null, { borderColor: COLORS.rule, borderWidth: 0.5 }); 
  
  const inX = rightX + 12;
  let inY = boxTop - 11.25;
  drawText((d.bigK || '').toUpperCase(), inX, inY - 5.6, sansRegular, 5.625, COLORS.soft, 0.14);
  
  inY -= 30;
  const bigN = d.bigN || '';
  const unit = d.bigU ? ` ${d.bigU}` : '';
  drawText(bigN, inX, inY, sansBold, 25.5, COLORS.ink, -0.035);
  const bw = monoBold.widthOfTextAtSize(bigN, 25.5);
  drawText(unit, inX + bw + 4, inY, sansRegular, 9.75, COLORS.soft);

  // Split (ledger / overtime requested vs credited)
  if (d.requestedHours) {
    const splitY = inY - 20;
    drawRule(inX, splitY, rightX + rightW - 12, splitY, 0.5, COLORS.hair);
    
    // Requested
    drawText('REQUESTED', inX, splitY - 10.5, sansRegular, 5.25, COLORS.faint, 0.12);
    const reqText = `${d.requestedHours} hrs`;
    drawText(reqText, inX, splitY - 19.5, monoRegular, 8.25, COLORS.faint);
    const strikeW = monoRegular.widthOfTextAtSize(reqText, 8.25);
    drawRule(inX, splitY - 16.5, inX + strikeW, splitY - 16.5, 0.75, COLORS.faint);

    // Credited
    const credX = inX + (rightW - 24) / 2;
    drawText('CREDITED', credX, splitY - 10.5, sansRegular, 5.25, COLORS.faint, 0.12);
    drawText(`${d.bigN} hrs`, credX, splitY - 19.5, monoRegular, 8.25, COLORS.ink);
  }

  // Outcome
  const outY = boxTop - boxH - 12; 
  const outText = (d.outcome || '').toUpperCase();
  const outW = sansBold.widthOfTextAtSize(outText, 6.75);
  const pillW = 6 + 4.5 + 6 + outW + 10; 
  // Draw outcome text with a bullet point
  drawText('\u2022', rightX, outY - 11.5, sansBold, 12, COLORS.ink, 0); // Dot
  drawText(outText, rightX + 8, outY - 11.5, sansBold, 6.75, COLORS.ink, 0.1);

  // Validation
  const hrdY = outY - 30; 
  drawRule(rightX, hrdY, rightX + rightW, hrdY, 0.75, COLORS.rule);
  drawText('HRD VALIDATION', rightX, hrdY - 11, sansBold, 5.625, COLORS.soft, 0.16);
  
  if (d.hrd) {
    d.hrd.forEach((h, i) => {
      const isRight = i % 2 !== 0;
      const hx = rightX + (isRight ? rightW / 2 : 0);
      const ypos = hrdY - 26 - Math.floor(i / 2) * 20;
      drawText((h[0] || '').toUpperCase(), hx, ypos, sansRegular, 5.25, COLORS.faint, 0.12);
      drawText(h[1] || '', hx, ypos - 10, monoRegular, 7.875, COLORS.ink);
    });
  }

  // 5 — ACCOUNTABILITY
  const bandY = bodyTop - 192; 
  drawRule(22.5, bandY, 612 - 22.5, bandY, 0.75, COLORS.rule);

  // verify block
  const qrW = 42; 
  const qrX = 612 - 22.5 - 136.5; 
  if (d.verificationToken) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://app.t3ckgroup.com';
    const qrUrl = `${origin}/verify/${d.verificationToken}`;
    const qrImage = await docAdapter.generateQR(qrUrl);
    drawImageAt(qrImage, qrX, bandY - 10 - qrW, qrW, qrW);
  }
  const tX = qrX + qrW + 7.5; 
  // Use record number for the URL as in HTML
  const vToken = (d.recordNo || '').toLowerCase();
  drawParagraph(`erp.t3ckgroup.com/verify/${vToken}`, tX, bandY - 10, 136.5 - qrW - 7.5, monoBold, 5.625, COLORS.ink, 6.5);
  drawParagraph('Scan for this record’s live status. Anyone may verify it; the reason and attachments open only for HR and the employee.', tX, bandY - 23, 136.5 - qrW - 7.5, sansRegular, 4.875, COLORS.faint, 6);

  // Sigs block
  if (d.sigs) {
    const sigsAreaW = qrX - 22.5 - 15; 
    const numSigs = d.sigs.length;
    const sigGap = 13.5;
    const sigW = (sigsAreaW - (numSigs - 1) * sigGap) / numSigs; 

    for (let i = 0; i < numSigs; i++) {
      const sx = 22.5 + i * (sigW + sigGap);
      await drawSignatureBox({
        docAdapter, fonts, drawText, drawRule, drawRect, drawImageAt,
        x: sx, plateTop: bandY - 10, plateW: sigW, plateH: 30, labelY: bandY - 6, block: d.sigs[i],
      });
    }
  }

  // Note
  const noteY = bandY - 10 - 30 - 30; 
  drawRule(22.5, noteY, 612 - 22.5, noteY, 0.5, COLORS.hair);
  if (d.note) {
    drawText(d.note, 22.5, noteY - 10, sansRegular, 5.625, COLORS.soft);
  }
}

function drawTextWrapped(text, x, y, maxWidth, font, size, color, drawText) {
  const str = String(text ?? '');
  if (font.widthOfTextAtSize(str, size) <= maxWidth) {
    drawText(str, x, y, font, size, color, -0.004);
    return;
  }
  let s = size;
  while (s > 5.5 && font.widthOfTextAtSize(str, s) > maxWidth) s -= 0.5;
  drawText(str, x, y, font, s, color, -0.004);
}
