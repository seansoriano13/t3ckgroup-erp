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

export const ALLOWED_MIME_TYPES = [
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/svg+xml",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/rtf",
  // Videos (kept short by MAX_ATTACHMENT_BYTES, not by codec)
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-msvideo",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
];

export const ALLOWED_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".zip", ".rar", ".7z",
  ".mp4", ".webm", ".mov", ".avi",
];

export const ALLOWED_EXTENSIONS_STRING = [...ALLOWED_EXTENSIONS, ...ALLOWED_MIME_TYPES].join(",");

export function isAllowedAttachment(file) {
  if (!file) return false;
  if (ALLOWED_MIME_TYPES.includes(file.type)) return true;
  const name = file.name || "";
  const lowerName = name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext)) || file.type.startsWith("image/");
}

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
