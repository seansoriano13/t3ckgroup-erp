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

/**
 * Attachment-condition "Accepts" groups (issue #203) — the multi-select an
 * Operations Manager picks from ("PDF or Images") instead of typing a
 * document type. Each group maps to the extensions and MIME types that
 * satisfy it; `attachmentAcceptType` below is how an uploaded file's group
 * gets tagged onto `sor_condition_status`/the log metadata for
 * `evaluateCondition`'s `accepts` match.
 */
export const ATTACHMENT_ACCEPT_GROUPS = {
  pdf: {
    label: "PDF",
    extensions: [".pdf"],
    mimeTypes: ["application/pdf"],
  },
  image: {
    label: "Images",
    extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".bmp", ".svg"],
    mimeTypes: [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/avif",
      "image/bmp",
      "image/svg+xml",
    ],
  },
  word: {
    label: "Word",
    extensions: [".doc", ".docx"],
    mimeTypes: [
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
  excel: {
    label: "Excel",
    extensions: [".xls", ".xlsx"],
    mimeTypes: [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
  powerpoint: {
    label: "PowerPoint",
    extensions: [".ppt", ".pptx"],
    mimeTypes: [
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  video: {
    label: "Video",
    extensions: [".mp4", ".webm", ".mov", ".avi"],
    mimeTypes: ["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"],
  },
  archive: {
    label: "Archive",
    extensions: [".zip", ".rar", ".7z"],
    mimeTypes: [
      "application/zip",
      "application/x-zip-compressed",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
    ],
  },
};

/** Labels for a condition's `accepts` list, joined for display ("PDF, Images"), or "Any" when empty. */
export function acceptsLabel(accepts = []) {
  if (!Array.isArray(accepts) || accepts.length === 0) return "Any";
  return accepts.map((key) => ATTACHMENT_ACCEPT_GROUPS[key]?.label || key).join(", ");
}

/**
 * Which Accepts group a file belongs to, by MIME type first and extension as
 * a fallback (Cloudinary sometimes drops the MIME type) — null when the file
 * matches no known group. This is the value stored as an attachment's `type`
 * for `evaluateCondition`'s `accepts` match (constants/stageGate.js).
 */
export function attachmentAcceptType(file) {
  if (!file) return null;
  const mime = file.type || "";
  const name = (file.name || "").toLowerCase();
  for (const [key, group] of Object.entries(ATTACHMENT_ACCEPT_GROUPS)) {
    if (mime && group.mimeTypes.includes(mime)) return key;
  }
  for (const [key, group] of Object.entries(ATTACHMENT_ACCEPT_GROUPS)) {
    if (group.extensions.some((ext) => name.endsWith(ext))) return key;
  }
  return null;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
