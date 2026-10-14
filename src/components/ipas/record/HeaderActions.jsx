import { Ban, FileLock2, MoreHorizontal, Pencil, Printer } from "lucide-react";

import IpasStateBadge from "@/components/ipas/IpasStateBadge";
import { Button } from "@/components/ui/button";
import Dropdown from "@/components/ui/Dropdown";
import { PrintPreviewButton } from "./PrintPreview";

const MENU_ITEM = "h-auto justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-normal";

/**
 * The page header's actions: the state, Preview (the one visible button), and
 * a More menu with the rest. Print and Print filing copy open the printed
 * IPAS; the Purchasing edits and Cancel IPAS show only while it is open and
 * the viewer may change it, as before.
 */
export default function HeaderActions({ ctx }) {
  const { ipas, can, on, busy, back } = ctx;
  return (
    <>
      <IpasStateBadge state={ipas.state} />
      <PrintPreviewButton ctx={ctx} />
      <Dropdown
        usePortal
        placement="bottom-end"
        popoverClassName="popover-enter z-[10001] w-max min-w-52 rounded-xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
        trigger={
          <Button variant="outline" aria-haspopup="menu">
            <MoreHorizontal size={14} />
            More
          </Button>
        }
      >
        {({ close }) => (
          <div className="flex flex-col gap-0.5">
            <Button
              variant="ghost"
              className={MENU_ITEM}
              disabled={busy.print}
              onClick={() => {
                close();
                on.print();
              }}
            >
              <Printer size={14} />
              {busy.print ? "Preparing…" : "Print"}
            </Button>
            {can.printFiling && (
              <Button
                variant="ghost"
                className={MENU_ITEM}
                disabled={busy.print}
                onClick={() => {
                  close();
                  on.printFiling();
                }}
              >
                <FileLock2 size={14} />
                Print filing copy
              </Button>
            )}
            {can.change && (
              <Button
                variant="ghost"
                className={MENU_ITEM}
                onClick={() => {
                  close();
                  on.editPurpose();
                }}
              >
                <Pencil size={14} />
                Purpose and SORs
              </Button>
            )}
            {can.change && (
              <>
                <div className="my-1 h-px bg-border" role="separator" />
                <Button
                  variant="ghost"
                  className={`${MENU_ITEM} text-red-11 hover:bg-red-9/10`}
                  onClick={() => {
                    close();
                    on.cancel();
                  }}
                >
                  <Ban size={14} />
                  Cancel IPAS
                </Button>
              </>
            )}
          </div>
        )}
      </Dropdown>
      {back}
    </>
  );
}
