import { createPdfAdapter, COLORS } from './adapter';
import { composeSheets, getBlankHalfRecord } from './layout';
import { drawTG11 } from './tg11';
import { drawTG12 } from './tg12';
import { hrSettingsService } from '../../services/hrSettingsService';

/** Dispatches a record to whichever half-sheet drawer its type calls for. */
async function drawRecord(page, docAdapter, record, offsetY, formSettings) {
  const draw = record.type === 'OVERTIME' ? drawTG12 : drawTG11;
  await draw(page, docAdapter, record, offsetY, formSettings);
}

export async function generateBulkPdf(records) {
  const docAdapter = await createPdfAdapter();
  const sheets = composeSheets(records);
  const formSettings = await hrSettingsService.getFormSettings().catch(() => null);

  const letterWidth = 612; // 8.5 inches
  const letterHeight = 792; // 11 inches

  for (const pair of sheets) {
    const page = docAdapter.doc.addPage([letterWidth, letterHeight]);
    
    // Draw cut line across the middle
    page.drawLine({
      start: { x: 0, y: letterHeight / 2 },
      end: { x: letterWidth, y: letterHeight / 2 },
      thickness: 1,
      color: COLORS.mauve5,
      dashArray: [5, 5]
    });
    
    // Draw corner marks for cutting
    const cm = 10;
    // Top-left
    page.drawLine({ start: { x: 0, y: letterHeight }, end: { x: cm, y: letterHeight }, thickness: 1, color: COLORS.mauve5 });
    page.drawLine({ start: { x: 0, y: letterHeight }, end: { x: 0, y: letterHeight - cm }, thickness: 1, color: COLORS.mauve5 });
    // Top-right
    page.drawLine({ start: { x: letterWidth, y: letterHeight }, end: { x: letterWidth - cm, y: letterHeight }, thickness: 1, color: COLORS.mauve5 });
    page.drawLine({ start: { x: letterWidth, y: letterHeight }, end: { x: letterWidth, y: letterHeight - cm }, thickness: 1, color: COLORS.mauve5 });
    // Bottom-left
    page.drawLine({ start: { x: 0, y: 0 }, end: { x: cm, y: 0 }, thickness: 1, color: COLORS.mauve5 });
    page.drawLine({ start: { x: 0, y: 0 }, end: { x: 0, y: cm }, thickness: 1, color: COLORS.mauve5 });
    // Bottom-right
    page.drawLine({ start: { x: letterWidth, y: 0 }, end: { x: letterWidth - cm, y: 0 }, thickness: 1, color: COLORS.mauve5 });
    page.drawLine({ start: { x: letterWidth, y: 0 }, end: { x: letterWidth, y: cm }, thickness: 1, color: COLORS.mauve5 });
    
    // The first record in the pair goes to the TOP half.
    // The top half has origin Y at 396 (letterHeight / 2).
    if (pair[0]) {
      await drawRecord(page, docAdapter, pair[0], 396, formSettings);
    }

    // The second record in the pair goes to the BOTTOM half.
    // The bottom half has origin Y at 0.
    if (pair[1]) {
      await drawRecord(page, docAdapter, pair[1], 0, formSettings);
    } else if (pair[0]) {
      // If there's an odd count, fill the spare half with a blank form of the matching type.
      await drawRecord(page, docAdapter, getBlankHalfRecord(pair[0].type), 0, formSettings);
    }
  }
  
  return await docAdapter.save();
}
