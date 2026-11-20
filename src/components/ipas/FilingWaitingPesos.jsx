import { CircleAlert } from "lucide-react";

/** Names each payment Filing waits on; the filing button is off while this shows. */
export function WaitingPesosNotice({ payments, className = "" }) {
  if (payments.length === 0) return null;
  return (
    <div
      role="alert"
      data-testid="ipas-filing-waiting-pesos"
      className={`rounded-xl border border-red-400 bg-red-3/40 p-3 text-[13px] text-red-11 ${className}`}
    >
      <p className="flex items-center gap-1.5 font-semibold">
        <CircleAlert size={15} aria-hidden="true" />
        Filing waits for the pesos. Fill in &ldquo;Pesos taken from the bank&rdquo; first.
      </p>
      <ul className="mt-1.5 space-y-0.5 text-xs">
        {payments.map((phrase) => (
          <li key={phrase}>Still blank: {phrase}</li>
        ))}
      </ul>
    </div>
  );
}
