// A document or sheet tick as read-only text, for the drawer: the box is an
// edit control, so the drawer says what is ticked in words (the label is read
// by screen readers, not shown twice).

export default function ReadTick({ checked, label }) {
  return (
    <span className="text-xs text-foreground">
      <span className="sr-only">{label}: </span>
      {checked ? "Yes" : <span className="text-muted-foreground">Not yet</span>}
    </span>
  );
}
