/**
 * Printing a Packing List (issue #260): the I/O around the pure pieces.
 *
 *   packingListService.get        the list, with its boxes and contents
 *   buildPackingListViewModel     what the paper says (packingListViewModel.js)
 *   buildPackingListDocument      the A4 sheet (packingListDocument.js)
 *   printIntoWindow               the browser's own print dialog
 *
 * The caller opens the window in the click (`openPackingListPrintWindow`): a
 * popup blocker only allows a window opened while the click is fresh.
 */

import { packingListService } from '../../services/packingListService';
import { buildPackingListDocument } from './packingListDocument';
import { buildPackingListViewModel } from './packingListViewModel';
import { printIntoWindow } from './htmlPrinter';

/** Opens the window the Packing List will print into. Call it synchronously in the click. Null when a popup blocker refused. */
export function openPackingListPrintWindow() {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write('<!DOCTYPE html><title>Packing List</title><body style="font-family:system-ui,sans-serif;color:#334155;padding:32px">Preparing the Packing List for printing…</body>');
  printWindow.document.close();
  return printWindow;
}

/** Prints one Packing List into `printWindow`. Closes the window and rethrows on failure, so no blank tab is left. */
export async function printPackingList(id, { printWindow } = {}) {
  try {
    const list = await packingListService.get(id);
    if (!list) throw new Error("That Packing List isn't there, or you don't have access to it.");
    await printIntoWindow(printWindow, buildPackingListDocument(buildPackingListViewModel(list)));
  } catch (error) {
    try {
      printWindow?.close();
    } catch {
      // The window was already closed.
    }
    throw error;
  }
}
