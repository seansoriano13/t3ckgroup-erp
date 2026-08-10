/**
 * Helpers for file attachments.
 *
 * Files live on Cloudinary (see storageService.uploadFileToCloudinary) and the
 * descriptors are stored as JSON on the owning row — `metadata.attachments` for
 * log notes, an `attachments` column for leave/overtime applications. Task
 * comments stored a bare URL string instead of a descriptor, so everything
 * reads through `toDescriptor`.
 */

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

function fileNameFromUrl(url) {
  try {
    return (
      decodeURIComponent(new URL(url).pathname.split("/").pop()) || "Attachment"
    );
  } catch {
    return "Attachment";
  }
}

export function toDescriptor(attachment) {
  if (!attachment) return null;
  if (typeof attachment === "string") {
    return { url: attachment, name: fileNameFromUrl(attachment), type: "" };
  }
  if (!attachment.url) return null;
  return {
    url: attachment.url,
    name: attachment.name || fileNameFromUrl(attachment.url),
    type: attachment.type || "",
    bytes: attachment.bytes,
  };
}

export function isImageAttachment(descriptor) {
  if (descriptor?.type?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(descriptor?.url || "");
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
