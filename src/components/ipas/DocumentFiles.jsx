import { useState } from "react";
import { Paperclip, X } from "lucide-react";

import { Button } from "./../ui/button";
import { ExternalLink } from "./../ui/external-link";
import { FileInput } from "./../ui/FileInput";
import Spinner from "./../ui/Spinner";
import { ALLOWED_EXTENSIONS_STRING } from "../../utils/attachments";
import { uploadDocumentFile } from "./uploadDocumentFile";

/**
 * Uploads each picked file and returns `[{ url, fileName }]` for the ones that went up. A refused or
 * failed file says why in a toast (uploadDocumentFile) and is left out; the others still go.
 */
async function uploadPicked(files) {
  const done = [];
  for (const file of files) {
    const url = await uploadDocumentFile(file);
    if (url) done.push({ url, fileName: file.name });
  }
  return done;
}

/**
 * A document's files (#1153): each listed by its file name, opening on click, with its own remove
 * button, and one Attach that takes several files in one pick.
 *
 *   files     `[{ id, url, fileName }]`
 *   onAdd     `(picked: [{ url, fileName }]) => Promise` called once per pick
 *   onRemove  `(file) => void`, one file at a time
 *   canChange false hides Attach and the remove buttons
 */
export function DocumentFiles({ label, files = [], canChange, onAdd, onRemove, missing = false }) {
  const [uploading, setUploading] = useState(false);
  const attach = async (picked) => {
    setUploading(true);
    try {
      const done = await uploadPicked(picked);
      if (done.length > 0) await onAdd(done);
    } finally {
      setUploading(false);
    }
  };
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs" data-testid="ipas-document-files">
      {files.map((file) => (
        <span key={file.id ?? file.url} className="inline-flex min-w-0 max-w-full items-center gap-1" data-testid="ipas-document-file">
          <ExternalLink href={file.url} className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground underline underline-offset-2">
            <Paperclip size={12} aria-hidden="true" className="shrink-0" />
            <span className="max-w-[14rem] truncate">{file.fileName}</span>
          </ExternalLink>
          {canChange && (
            <Button type="button" variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={`Remove ${file.fileName} from ${label}`} onClick={() => onRemove(file)}>
              <X />
            </Button>
          )}
        </span>
      ))}
      {canChange ? (
        <FileInput
          data-missing-file={missing ? "documents" : undefined}
          accept={ALLOWED_EXTENSIONS_STRING}
          multiple
          disabled={uploading}
          onFiles={attach}
          size="xs"
          className="gap-1"
          aria-label={`Attach a file to ${label}`}
        >
          {uploading ? <Spinner size="sm" /> : <Paperclip size={12} aria-hidden="true" />}
          {uploading ? "Uploading…" : files.length > 0 ? "Add more" : "Attach"}
        </FileInput>
      ) : (
        files.length === 0 && <span className="text-muted-foreground">No attachment</span>
      )}
    </span>
  );
}
