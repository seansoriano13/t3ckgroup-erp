/**
 * Printing a TSR (issue #259): the I/O around the pure pieces.
 *
 *   buildTsrViewModel             what the sheet says (tsrViewModel.js)
 *   hydratePicturesForPrint       "Print with photographs": each picture as a data URI (ADR 0014)
 *   buildTsrDocument              the A4 sheet (tsrDocument.js)
 *   printIntoWindow               the browser's own print dialog
 *
 * The caller opens the window in the click (`openTsrPrintWindow`). Videos
 * never print, so only pictures are hydrated.
 */

import { transmittalService } from '../../services/transmittalService';
import { buildTsrDocument } from './tsrDocument';
import { buildTsrViewModel } from './tsrViewModel';
import { openPrintWindow, printIntoWindow } from './htmlPrinter';

/** Opens the window the TSR will print into. Call it synchronously in the click. Null when a popup blocker refused. */
export function openTsrPrintWindow() {
  return openPrintWindow('TSR');
}

/** A picture's bytes as a data URI, so the printed page holds it without a link. */
async function dataUriOf(storagePath) {
  const url = await transmittalService.evidenceUrl(storagePath);
  const response = await fetch(url);
  if (!response.ok) throw new Error('A photograph could not be loaded for printing.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Every picture on the TSR as `{ src, fileName }`. Videos are left out. */
export async function hydratePicturesForPrint(evidence = []) {
  const pictures = evidence.filter((e) => e.kind === 'picture');
  return Promise.all(pictures.map(async (e) => ({ src: await dataUriOf(e.storagePath), fileName: e.fileName })));
}

/**
 * Prints one TSR into `printWindow`. `withPhotographs` embeds the pictures
 * (the filing copy). Closes the window and rethrows on failure.
 */
export async function printTsr(tsr, { printWindow, withPhotographs = false } = {}) {
  try {
    const vm = buildTsrViewModel(tsr);
    const photos = withPhotographs ? await hydratePicturesForPrint(tsr.evidence ?? []) : [];
    await printIntoWindow(printWindow, buildTsrDocument(vm, { withPhotographs, photos }));
  } catch (error) {
    try {
      printWindow?.close();
    } catch {
      // The window was already closed.
    }
    throw error;
  }
}
