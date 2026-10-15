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
import { signatureService } from '../../services/signatureService';
import { buildTransmittalDocument } from './transmittalDocument';
import { buildTransmittalViewModel } from './transmittalViewModel';
import { openPrintWindow, printIntoWindow } from './htmlPrinter';

/** Opens the window the Transmittal will print into. Call it synchronously in the click. Null when a popup blocker refused. */
export function openTransmittalPrintWindow() {
  return openPrintWindow('Transmittal');
}

/** A stored signature file as a data URI, so the printed plate holds the image. */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Puts each signer's stored signature on the stage rows as `signatureBase64`
 * (#258). A signer with no file, or one whose file won't load, prints the name only.
 */
async function hydrateSignatures(transmittal) {
  const signers = (transmittal.stages ?? []).flatMap((s) => [s.first_signer, s.second_signer]).filter((p) => p?.signature_path);
  const images = new Map();
  await Promise.all(
    [...new Set(signers.map((p) => p.signature_path))].map(async (path) => {
      try {
        const blob = await signatureService.downloadSignature(path);
        if (blob) images.set(path, await blobToDataUrl(blob));
      } catch (error) {
        console.warn("Failed to load signature for the printed Transmittal", error);
      }
    }),
  );
  for (const signer of signers) {
    const image = images.get(signer.signature_path);
    if (image) signer.signatureBase64 = image;
  }
}

/** Prints one Transmittal into `printWindow`. Closes the window and rethrows on failure, so no blank tab is left. */
export async function printTransmittal(id, { printWindow } = {}) {
  try {
    const [transmittal, checkByRoster, referenceOptions] = await Promise.all([
      transmittalService.get(id),
      // The roster and checklist are print furniture: a failed read leaves them blank.
      transmittalService.checkByRoster().catch(() => []),
      transmittalService.referenceOptions().catch(() => []),
    ]);
    if (!transmittal) throw new Error("That Transmittal isn't there, or you don't have access to it.");
    await hydrateSignatures(transmittal);
    transmittal.checkByRoster = checkByRoster;
    transmittal.referenceOptions = referenceOptions;
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
