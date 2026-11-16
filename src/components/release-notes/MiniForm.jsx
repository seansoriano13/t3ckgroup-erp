import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FieldBox } from "@/components/ui/FieldBox"
import { Input } from "@/components/ui/input"
import { SelectField } from "@/components/ui/SelectField"

/**
 * A small form a reader can try, as a form used to behave ("before") or behaves now ("after").
 * Before: pressing the button points at the first empty field only, the way the browser did.
 * After: every required field is marked, every empty one is named at once, and `check` can add a
 * warning that turns the button off (the File Time Off balance). Nothing is sent anywhere: the
 * button only checks what was typed here.
 */
export default function MiniForm({ fields, mode, submitLabel, check }) {
  const after = mode === "after"
  const [values, setValues] = useState({})
  const [tried, setTried] = useState(false)
  const [bubbleFor, setBubbleFor] = useState(null)
  const [done, setDone] = useState(false)
  const missing = fields.filter((f) => !String(values[f.key] ?? "").trim()).map((f) => f.key)
  const warning = after && check ? check(values) : null

  const set = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }))
    setBubbleFor(null)
    setDone(false)
  }
  const submit = () => {
    setDone(missing.length === 0)
    if (after) setTried(true)
    else setBubbleFor(missing[0] ?? null)
  }

  return (
    <div className="space-y-2.5">
      {fields.map((field) => {
        const error = after && tried && missing.includes(field.key) ? field.error : null
        return (
          <div key={field.key} className="relative">
            <FieldBox label={field.label} required={after}>
              {field.options ? (
                <SelectField
                  options={field.options.map((o) => ({ value: o, label: o }))}
                  value={values[field.key] ?? null}
                  onChange={(v) => set(field.key, v)}
                  placeholder={field.placeholder ?? "Choose…"}
                  error={Boolean(error)}
                  className="w-full"
                />
              ) : (
                <Input
                  value={values[field.key] ?? ""}
                  onChange={(e) => set(field.key, e.target.value)}
                  placeholder={field.placeholder}
                  inputMode={field.numeric ? "decimal" : undefined}
                  aria-invalid={error ? true : undefined}
                />
              )}
            </FieldBox>
            {error && <p className="animate-slide-down mt-1 text-xs font-medium text-destructive">{error}</p>}
            {bubbleFor === field.key && (
              <div role="status" className="animate-slide-down absolute top-full left-3 z-10 -mt-1 flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground shadow-lg">
                <span className="flex size-4 items-center justify-center rounded-sm bg-amber-a5 text-[10px] font-bold text-amber-12" aria-hidden="true">!</span>
                Please fill out this field.
              </div>
            )}
          </div>
        )
      })}
      {warning && <p className="animate-slide-down text-xs font-medium text-foreground">{warning}</p>}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="button" variant={after ? "primary" : "outline"} size="sm" onClick={submit} disabled={Boolean(warning)}>
          {submitLabel}
        </Button>
        {done && <span className="text-xs text-green-11">All filled in. It is a sample, so nothing is sent.</span>}
      </div>
    </div>
  )
}
