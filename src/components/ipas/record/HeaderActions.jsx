import { Ban, FileLock2, Pencil, Printer } from "lucide-react";

import IpasStateBadge from "@/components/ipas/IpasStateBadge";
import RecordMoreMenu from "@/components/record/RecordMoreMenu";
import { PrintPreviewButton } from "./PrintPreview";

/**
 * The page header's actions: the state, Preview (the one visible button), and
 * a More menu with the rest. Print and Print filing copy open the printed
 * IPAS; the Purchasing edits and Cancel IPAS show only while it is open and
 * the viewer may change it, as before.
 */
export default function HeaderActions({ ctx }) {
  const { ipas, can, on, busy, back } = ctx;
  const items = [
    { key: "print", label: busy.print ? "Preparing…" : "Print", icon: Printer, disabled: busy.print, onSelect: on.print },
  ];
  if (can.printFiling) {
    items.push({ key: "filing", label: "Print filing copy", icon: FileLock2, disabled: busy.print, onSelect: on.printFiling });
  }
  if (can.change) {
    // A Project's SORs are fixed when it is raised, so its Purpose has nowhere to go (#551).
    if (!ipas.sors?.length) items.push({ key: "purpose", label: "Purpose", icon: Pencil, onSelect: on.editPurpose });
    items.push({ key: "cancel", label: "Cancel IPAS", icon: Ban, destructive: true, onSelect: on.cancel });
  }
  return (
    <>
      <IpasStateBadge state={ipas.state} />
      <PrintPreviewButton ctx={ctx} />
      <RecordMoreMenu items={items} />
      {back}
    </>
  );
}
