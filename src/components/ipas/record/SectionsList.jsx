import RecordRows from "@/components/record/RecordRows";
import { SECTIONS, sectionState } from "./digest";

/**
 * The IPAS's sections as rows: money and sign-offs first, everything else
 * under them. The rows themselves are the shared RecordRows.
 */
export default function SectionsList({ digest, ...rest }) {
  return (
    <RecordRows
      groups={[
        { title: "Money and sign-offs", sections: SECTIONS.filter((section) => !section.secondary) },
        { title: "Everything else", sections: SECTIONS.filter((section) => section.secondary) },
      ]}
      stateOf={(key) => sectionState(key, digest)}
      summaryOf={(key) => digest.lines[key]}
      {...rest}
    />
  );
}
