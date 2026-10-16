import RecordDrawer from "@/components/record/RecordDrawer";
import { DRAWER_SECTIONS } from "./digest";
import { canEditSection, footerMovesFor } from "./moves";

/**
 * The IPAS's section drawer: the shared RecordDrawer, given this section's body
 * (`blocks[key]`), its digest line, the viewer's moves for it (the same moves
 * as the card) and whether the viewer may edit it. The money in the body is
 * read-only here.
 */
export default function SectionDrawer({ ctx, blocks, digest, index, current, step, close, getRow, onEdit }) {
  const { ipas, busy, failure, viewer } = ctx;
  return (
    <RecordDrawer
      number={ipas.number}
      sections={DRAWER_SECTIONS}
      current={current}
      index={index}
      step={step}
      close={close}
      getRow={getRow}
      onEdit={onEdit}
      body={current ? blocks[current.key] : null}
      summary={current ? digest.lines[current.key] : ""}
      moves={current ? footerMovesFor(ctx, digest, current.key) : []}
      editable={Boolean(current) && canEditSection(current.key, ctx)}
      restate={(section) => digest.lines[section]}
      viewer={viewer}
      busy={busy.signoff || busy.give}
      failure={failure}
    />
  );
}
