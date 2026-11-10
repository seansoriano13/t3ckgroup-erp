import toast from "react-hot-toast";

import { storageService } from "../../services/storageService";
import { MAX_ATTACHMENT_BYTES, formatBytes, isAllowedAttachment } from "../../utils/attachments";

/**
 * Uploads a document's file to Cloudinary, as a payment's proof of payment is,
 * and returns its link. Says why with a toast and returns null when the file
 * isn't allowed, is too big or the upload fails.
 */
export async function uploadDocumentFile(file) {
  if (!file) return null;
  if (!isAllowedAttachment(file)) {
    toast.error(`${file.name} is not a supported file type.`);
    return null;
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    toast.error(`${file.name} is too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)}).`);
    return null;
  }
  try {
    const uploaded = await storageService.uploadFileToCloudinary(file);
    return uploaded?.url ?? null;
  } catch (error) {
    toast.error(error?.message || "The file couldn't be uploaded.");
    return null;
  }
}
