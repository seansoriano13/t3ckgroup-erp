/**
 * Printing an IPAS (issue #250, ADR 0014): the I/O around the pure pieces.
 *
 *   ipasService.getForPrint   refreshes the Odoo copy first, unless filed
 *   buildIpasViewModel        what the paper says (ipasViewModel.js)
 *   hydrateIpasSignatures     stored signatures, fetched as images
 *   buildIpasDocument         the two A4 pages (ipasDocument.js)
 *   printIntoWindow           the browser's own print dialog
 *
 * The caller opens the window in the click (`openPrintWindow`), because the
 * refresh is a network round trip and a popup blocker only allows a window
 * opened while the click is fresh.
 */

import { ipasService } from '../../services/ipasService';
import { signatureService } from '../../services/signatureService';
import { buildIpasDocument } from './ipasDocument';
import { buildIpasViewModel } from './ipasViewModel';
import { printIntoWindow } from './htmlPrinter';

const PLACEHOLDER =
  '<!DOCTYPE html><title>IPAS</title><body style="font-family:system-ui,sans-serif;color:#334155;padding:32px">Preparing the IPAS for printing…</body>';

/**
 * Opens the window the IPAS will print into. Call it synchronously in the
 * click handler. Returns null when a popup blocker refused.
 */
export function openPrintWindow() {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return null;
  printWindow.document.open();
  printWindow.document.write(PLACEHOLDER);
  printWindow.document.close();
  return printWindow;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Fetches each stored signature once and puts the image on the box. A box with
 * no stored signature, or that declined, has no path and prints the name only;
 * one whose file can't be fetched falls back to the name too, and says so.
 */
export async function hydrateIpasSignatures(vm) {
  const boxes = [...vm.section1.signoffs, ...vm.section3.signoffs, ...vm.section7.signoffs];
  const images = new Map();

  await Promise.all(
    [...new Set(boxes.map((box) => box.signaturePath).filter(Boolean))].map(async (path) => {
      try {
        const blob = await signatureService.downloadSignature(path);
        if (blob) images.set(path, await blobToDataUrl(blob));
      } catch (error) {
        console.warn('Failed to load signature for the printed IPAS', error);
      }
    }),
  );

  for (const box of boxes) {
    if (!box.signaturePath) continue;
    const image = images.get(box.signaturePath);
    if (image) box.signatureBase64 = image;
    else box.stamp = `${box.stamp} · signature image unavailable`;
  }
  return vm;
}

/** The IPAS as a view model with its signatures, ready to compose. Refreshes from Odoo first unless filed. */
export async function prepareIpasForPrint(id, { filingCopy = false, printedBy = null, now = new Date() } = {}) {
  const ipas = await ipasService.getForPrint(id);
  if (!ipas) throw new Error("That IPAS isn't there, or you don't have access to it.");
  const vm = buildIpasViewModel(ipas, { filingCopy, printedAt: now.toISOString(), printedBy });
  return hydrateIpasSignatures(vm);
}

/**
 * Prints one IPAS into `printWindow` (from `openPrintWindow`). Closes the
 * window and rethrows when anything fails, so no blank tab is left behind.
 */
export async function printIpas(id, { printWindow, filingCopy = false, printedBy = null } = {}) {
  try {
    const vm = await prepareIpasForPrint(id, { filingCopy, printedBy });
    await printIntoWindow(printWindow, buildIpasDocument(vm));
  } catch (error) {
    try {
      printWindow?.close();
    } catch {
      // The window was already closed.
    }
    throw error;
  }
}
