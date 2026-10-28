import { useState } from "react";
import { ListPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { transmittalService } from "@/services/transmittalService";
import { ipasErrorMessage } from "@/utils/ipas";

/**
 * "Fill from an IPAS" (#725): type an IPAS number and every PO line of that IPAS
 * goes on the slip as a draft line. The preparer then removes what did not arrive
 * or edits a quantity for a part delivery, the same as any other line.
 *
 * `onFill(picks)` receives the IPAS's PO lines (shaped like the live list's).
 */
export default function FillFromIpas({ onFill }) {
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const fill = async () => {
    if (!number.trim() || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const picks = await transmittalService.poLinesOfIpas(number);
      if (picks.length === 0) {
        setProblem("That IPAS has no PO lines.");
        return;
      }
      onFill(picks);
      setNumber("");
    } catch (error) {
      setProblem(ipasErrorMessage(error, "The IPAS lines could not be loaded."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 space-y-1.5">
      <div className="flex gap-2">
        <Input
          className="h-11"
          value={number}
          onChange={(event) => {
            setNumber(event.target.value);
            setProblem(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              fill();
            }
          }}
          placeholder="Fill from an IPAS number"
          aria-label="IPAS number"
        />
        <Button type="button" variant="outline" onClick={fill} disabled={busy || !number.trim()} className="h-11 shrink-0 gap-1.5">
          <ListPlus size={14} /> Fill lines
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-[12px] text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
