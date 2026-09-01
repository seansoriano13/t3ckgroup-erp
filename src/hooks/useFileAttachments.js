import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { storageService } from "../services/storageService";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  isAllowedAttachment,
  formatBytes,
} from "../utils/attachments";

/**
 * Owns the pick → validate → preview → upload cycle for file attachments.
 *
 * Files are held locally until `upload()` is called, so nothing reaches
 * Cloudinary for a form the user abandons. `upload()` returns the descriptors
 * to persist ({ url, name, type, bytes }).
 */
export function useFileAttachments({ max = MAX_ATTACHMENTS } = {}) {
  const [files, setFiles] = useState([]); // [{ file, preview }]
  const [isUploading, setIsUploading] = useState(false);

  // Validation runs outside the state updater — toasts and createObjectURL are
  // side effects, and React double-invokes updaters in StrictMode.
  const addFiles = useCallback(
    (picked) => {
      const incoming = Array.from(picked || []);
      if (!incoming.length) return;

      const room = max - files.length;
      if (room <= 0) {
        toast.error(`You can attach at most ${max} files.`);
        return;
      }

      const accepted = [];
      for (const file of incoming.slice(0, room)) {
        if (!isAllowedAttachment(file)) {
          toast.error(`${file.name} is not a supported file type.`);
          continue;
        }

        if (file.size > MAX_ATTACHMENT_BYTES) {
          toast.error(
            `${file.name} is too large (max ${formatBytes(MAX_ATTACHMENT_BYTES)}).`,
          );
          continue;
        }
        accepted.push({
          file,
          preview: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : null,
        });
      }

      if (incoming.length > room) {
        toast.error(`Only ${max} files allowed — the rest were skipped.`);
      }
      if (accepted.length) setFiles((prev) => [...prev, ...accepted]);
    },
    [files.length, max],
  );

  const removeFile = useCallback((index) => {
    setFiles((prev) => {
      const next = [...prev];
      if (next[index]?.preview) URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setFiles((prev) => {
      prev.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      return [];
    });
  }, []);

  /** Uploads everything held and resolves to the descriptors. Throws on failure. */
  const upload = useCallback(async () => {
    if (files.length === 0) return [];
    setIsUploading(true);
    try {
      return await Promise.all(
        files.map((f) => storageService.uploadFileToCloudinary(f.file)),
      );
    } finally {
      setIsUploading(false);
    }
  }, [files]);

  /** Pulls files out of a paste event. Returns true when it handled the paste. */
  const addFromPaste = useCallback(
    (event) => {
      const pasted = Array.from(event.clipboardData?.items || [])
        .filter((it) => it.kind === "file")
        .map((it) => it.getAsFile())
        .filter(Boolean);
      if (!pasted.length) return false;
      event.preventDefault();
      addFiles(pasted);
      return true;
    },
    [addFiles],
  );

  return { files, isUploading, addFiles, addFromPaste, removeFile, clear, upload, max };
}
