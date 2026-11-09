/** Every sign-off of the final IPAS, Logistics first, each with who gave it or who gives it. */
export default function SignoffList({ steps }) {
  return (
    <ol className="divide-y divide-border rounded-xl border border-border">
      {steps.map((step, index) => (
        <li key={step.key} id={`ipas-signoff-${step.key}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
          <span className={`mt-0.5 font-mono text-xs ${step.done ? "text-green-11" : "text-muted-foreground"}`}>
            {step.done ? "✓" : index + 1}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{step.label}</p>
            <p className="text-xs text-muted-foreground">{step.done ? step.line : `Who: ${step.who.names}`}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
