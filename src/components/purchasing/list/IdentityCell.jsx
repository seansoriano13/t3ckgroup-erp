import { TableCell } from "@/components/ui/table";
import HighlightText from "@/components/HighlightText";

/**
 * A Purchasing list's first column (spec #631): what the record is called.
 *
 * - `reference`  a number such as an IPAS or TG03 number, in mono; or
 * - `word`       a word such as "Direct" or "No SOR", never in mono, so it is
 *                not mistaken for a number.
 * - `name`       the record's name, under it.
 *
 * `hairline` marks the row quietly on its left edge (a Direct request).
 * `search`     the list's search text; matches are highlighted.
 * `children` render under the name (a second quiet line).
 */
export function IdentityCell({ reference, word, name, tooltip, search, hairline = false, className = "", children }) {
  return (
    <TableCell className={`${hairline ? "border-l-2 border-l-mauve-7" : ""} ${className}`.trim()}>
      <IdentityText reference={reference} word={word} name={name} tooltip={tooltip} search={search}>
        {children}
      </IdentityText>
    </TableCell>
  );
}

/** The same two lines without the cell, for a list that draws its own cell. */
export function IdentityText({ reference, word, name, tooltip, search, children }) {
  return (
    <>
      {word ? (
        <span className="block text-[11px] font-medium text-muted-foreground">
          <HighlightText text={word} search={search} />
        </span>
      ) : (
        <span className="block font-mono text-xs font-semibold text-foreground">
          <HighlightText text={reference} search={search} />
        </span>
      )}
      {name ? (
        // A name can be a long Odoo product name: two lines, the rest on hover.
        <span title={tooltip ?? name}className="mt-0.5 line-clamp-2 max-w-[22rem] break-words text-sm text-foreground">
          <HighlightText text={name} search={search} />
        </span>
      ) : null}
      {children}
    </>
  );
}
