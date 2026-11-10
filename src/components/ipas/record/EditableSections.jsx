import { useEffect } from "react";

import EditBar from "./EditBar";
import SectionsPanel from "./SectionsPanel";
import { missingRequiredFiles } from "./missingFiles";
import { useIpasEditForm } from "./useIpasEditForm";

/**
 * The record's sections, with editing in place (#581). Out of edit mode it is just the
 * SectionsPanel; with `editKey` set (?edit=) the sections that take typing show their
 * fields, and one bar at the foot holds Save all. The typed state lives here, so it is
 * kept while the person moves around the page, and dropped when edit mode ends.
 */
export default function EditableSections({
  ctx,
  blocks,
  digest,
  open,
  headRef,
  editKey,
  onEdit,
  onDone,
  canSave,
  savedCount,
  saving,
  onSave,
  onEditPurpose,
  onRemoveSaved,
  onRemoveDocument,
  onSuggest,
  notice,
  failure,
}) {
  const { ipas, can } = ctx;
  const editor = useIpasEditForm({ ipas, savedCount, onSave });

  const { clear } = editor;
  useEffect(() => {
    if (!editKey) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);

  const missingFiles = missingRequiredFiles({ ipas, digest });

  const edit = editKey
    ? { ...editor, ipas, can, focusKey: editKey, onEditPurpose, money: { onRemoveSaved, onRemoveDocument, onSuggest } }
    : null;

  return (
    <div className="min-w-0 space-y-4">
      <SectionsPanel ctx={ctx} blocks={blocks} digest={digest} open={open} headRef={headRef} onEdit={onEdit} edit={edit} />
      {editKey && (
        <EditBar editor={editor} canSave={canSave} saving={saving} onDone={onDone} reveal={open.reveal} show={open.show} missingFiles={missingFiles} notice={notice} failure={failure} />
      )}
    </div>
  );
}
