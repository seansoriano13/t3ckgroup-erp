import { useOpenSection as useRecordOpenSection } from "@/components/record/useOpenSection";

import { DRAWER_SECTIONS, SECTIONS } from "./digest";

const IN_PLACE = SECTIONS.filter((section) => section.inPlace).map((section) => section.key);

/** The IPAS's open section: the shared hook over the IPAS's sections. */
export function useOpenSection() {
  return useRecordOpenSection({ drawerSections: DRAWER_SECTIONS, inPlaceKeys: IN_PLACE });
}
