/** A section's heading inside a Transmittal modal: the title, an optional one-line note, and an aside (a button) on the right. */
export default function SectionTitle({ title, note, aside }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[15px] font-black tracking-tight text-foreground">{title}</h3>
        {note && <p className="mt-0.5 text-[13px] text-muted-foreground">{note}</p>}
      </div>
      {aside}
    </div>
  );
}
