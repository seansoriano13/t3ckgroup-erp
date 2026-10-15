/**
 * Printing a Transmittal as TG03 (issue #258): the I/O around the pure pieces.
 *
 *   transmittalService.get        the slip, with its lines, stages and Check by
 *   buildTransmittalViewModel     what the paper says (transmittalViewModel.js)
 *   buildTransmittalDocument      the A4 sheets (transmittalDocument.js)
 *   printIntoWindow               the browser's own print dialog
 *
 * The caller opens the window in the click (`openTransmittalPrintWindow`): a
 * popup blocker only allows a window opened while the click is fresh.
 */

import { transmittalService } from '../../services/transmittalService';
import { buildTransmittalDocument } from './transmittalDocument';
import { buildTransmittalViewModel } from './transmittalViewModel';
import { printIntoWindow } from './htmlPrinter';

/** Opens the window the Transmittal will print into. Call it synchronously in the click. Null when a popup blocker refused. */
export function openTransmittalPrintWindow() {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write('<!DOCTYPE html><title>Transmittal</title><body style="font-family:system-ui,sans-serif;color:#334155;padding:32px">Preparing the Transmittal for printing…</body>');
  printWindow.document.close();
  return printWindow;
}

/** Prints one Transmittal into `printWindow`. Closes the window and rethrows on failure, so no blank tab is left. */
export async function printTransmittal(id, { printWindow } = {}) {
  try {
    const transmittal = await transmittalService.get(id);
    if (!transmittal) throw new Error("That Transmittal isn't there, or you don't have access to it.");
    await printIntoWindow(printWindow, buildTransmittalDocument(buildTransmittalViewModel(transmittal)));
  } catch (error) {
    try {
      printWindow?.close();
    } catch {
      // The window was already closed.
    }
    throw error;
  }
}
