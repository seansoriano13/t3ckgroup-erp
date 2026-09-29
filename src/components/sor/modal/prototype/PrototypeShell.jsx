/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype (ADR 0028). The one entry
 * SorModal lazy-loads on staging/local: the chosen layout plus the switcher
 * bar. Keyed on the layout so a switch fades the new one in.
 */
import SorModalPrototype from "./SorModalPrototype";
import PrototypeSwitcher, { usePrototypeVariant } from "./PrototypeSwitcher";

export default function PrototypeShell({ p }) {
  const [variant, setVariant] = usePrototypeVariant();
  return (
    <>
      <div key={variant} className="flex min-h-0 flex-1 flex-col animate-in fade-in-0 duration-200">
        <SorModalPrototype variant={variant} p={p} />
      </div>
      <PrototypeSwitcher variant={variant} setVariant={setVariant} />
    </>
  );
}
