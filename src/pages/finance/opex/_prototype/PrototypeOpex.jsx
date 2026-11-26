// PROTOTYPE (throwaway): three redesign options for the OPEX Report, on the real routes.
// Open /finance/opex?variant=A (or B, C). The bar at the bottom, or the ← → keys, switch option.
// Every option reads the real staging data; edits stay in this browser tab and are never saved.
import { useNavigate, useSearchParams } from "react-router";

import { ListA, RecordA } from "./VariantA";
import { ListB, RecordB } from "./VariantB";
import { ListC, PanelC } from "./VariantC";
import PrototypeSwitcher from "./PrototypeSwitcher";

export default function PrototypeOpex({ variant, s0 = null }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const full = params.get("full") === "1";
  const open = (next) => navigate(`/finance/opex/${next}?variant=${variant}`);
  const close = () => navigate(`/finance/opex?variant=${variant}`);

  return (
    <>
      {variant === "A" && <ListA onOpen={open}>{s0 && <RecordA s0={s0} onClose={close} />}</ListA>}
      {variant === "B" && <ListB onOpen={open}>{s0 && <RecordB s0={s0} onClose={close} />}</ListB>}
      {variant === "C" && (
        <ListC onOpen={open} openS0={s0}>
          {(rows) => (
            <>
              <PanelC s0={full ? null : s0} rows={rows} onOpen={open} onClose={close} onOpenFull={(x) => navigate(`/finance/opex/${x}?variant=C&full=1`)} />
              {full && s0 && <RecordA s0={s0} onClose={() => open(s0)} />}
            </>
          )}
        </ListC>
      )}
      <PrototypeSwitcher />
    </>
  );
}
