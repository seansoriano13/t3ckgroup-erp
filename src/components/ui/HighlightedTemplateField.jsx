import { forwardRef, useEffect, useRef, useImperativeHandle } from "react"
import { cn } from "@/lib/utils"
import { TEMPLATE_VARIABLES } from "@/constants/taskTemplates"

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g
const VARIABLE_BY_KEY = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v]))
const ZWS = "​" // caret anchor after an atomic chip — stripped back out on serialize

const CHIP_CLASS =
  "inline-block select-none whitespace-nowrap rounded-md bg-violet-a4 px-1.5 py-0.5 mx-0.5 align-baseline text-[0.85em] font-bold text-violet-11"

function makeChip(key) {
  const chip = document.createElement("span")
  chip.setAttribute("contenteditable", "false")
  chip.dataset.tokenKey = key
  chip.className = CHIP_CLASS
  chip.textContent = VARIABLE_BY_KEY.get(key)?.label || key
  return chip
}

/** Rebuilds the editable DOM from a plain `{{key}}`-bearing string. */
export function buildDom(el, text) {
  el.innerHTML = ""
  const appendText = (str) => {
    const lines = str.split("\n")
    lines.forEach((line, i) => {
      if (line) el.appendChild(document.createTextNode(line))
      if (i < lines.length - 1) el.appendChild(document.createElement("br"))
    })
  }
  let lastIndex = 0
  let match
  const re = new RegExp(TOKEN_PATTERN)
  while ((match = re.exec(text))) {
    if (match.index > lastIndex) appendText(text.slice(lastIndex, match.index))
    el.appendChild(makeChip(match[1]))
    el.appendChild(document.createTextNode(ZWS))
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) appendText(text.slice(lastIndex))
}

/**
 * Whether a new chip inserted at `range`'s start needs a leading space first:
 * true unless the caret already sits at the very start of the field or right
 * after whitespace. Looks past a caret anchor (`ZWS`) to the real character
 * or chip before it, since a fresh anchor's own text is empty.
 */
function caretNeedsLeadingSpace(range) {
  const { startContainer, startOffset } = range
  if (startContainer.nodeType === Node.TEXT_NODE) {
    const before = startContainer.textContent.slice(0, startOffset).split(ZWS).join("")
    if (before.length > 0) return !/\s$/.test(before)
    const prev = startContainer.previousSibling
    if (!prev) return false
    if (prev.nodeType === Node.ELEMENT_NODE) return true
    return !/\s$/.test(prev.textContent.split(ZWS).join(""))
  }
  const prevNode = startContainer.childNodes[startOffset - 1]
  if (!prevNode) return false
  if (prevNode.nodeType === Node.ELEMENT_NODE) return true
  return !/\s$/.test(prevNode.textContent.split(ZWS).join(""))
}

/** The DOM's inverse: chip spans become `{{key}}`, `<br>` becomes `\n`. */
export function serializeDom(el) {
  let out = ""
  el.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent.split(ZWS).join("")
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (node.tagName === "BR") out += "\n"
      else if (node.dataset?.tokenKey) out += `{{${node.dataset.tokenKey}}}`
    }
  })
  return out
}

/**
 * Issue #204 — a raw `{{so_number}}` sitting in a title read as noise, not a
 * working part, and clicking two variable chips in a row jammed their raw
 * syntax together with no space between. This masks every token as an
 * atomic, colored "SO Number"-style chip while typing — the same idea as a
 * mail-merge field in a real document editor — while the value this reports
 * through `onChange` stays the plain `{{so_number}}` string every other part
 * of the feature (rendering, storage, the preview card) already expects.
 *
 * A chip is `contenteditable="false"` inside the editable root, which is
 * what makes it atomic: one Backspace removes the whole chip, arrow keys
 * step over it as a unit, and it can never be edited mid-token. A trailing
 * zero-width space anchors the caret immediately after a chip so typing (or
 * inserting a second chip right after) continues normally; `insertToken`
 * adds a real space before a new chip whenever the caret isn't already
 * after whitespace or at the very start, so clicking several chips in a row
 * reads as words, not a run-on.
 *
 * The DOM is only ever rebuilt from `value` when `value` changed for a
 * reason other than this component's own last edit (an external reset, a
 * loaded `initialData`, or `insertToken`'s own direct DOM write already
 * ahead of the prop) — rebuilding on every keystroke would reset the caret
 * to the start of the field on every character typed.
 */
const HighlightedTemplateField = forwardRef(function HighlightedTemplateField(
  { as = "input", value, onChange, className, wrapperClassName, placeholder, name },
  ref,
) {
  const editableRef = useRef(null)
  const domValueRef = useRef(null)
  const isTextarea = as === "textarea"

  useImperativeHandle(ref, () => ({
    focus: () => editableRef.current?.focus(),
    insertToken: (tokenString) => insertToken(tokenString),
  }))

  useEffect(() => {
    const el = editableRef.current
    if (!el) return
    const next = value || ""
    if (domValueRef.current === next) return // our own edit already produced this value
    buildDom(el, next)
    domValueRef.current = next
  }, [value])

  const emitChange = () => {
    const el = editableRef.current
    if (!el) return
    const next = serializeDom(el)
    domValueRef.current = next
    onChange?.({ target: { name, value: next } })
  }

  const insertToken = (tokenString) => {
    const el = editableRef.current
    if (!el) return
    el.focus()
    const key = /\{\{\s*([a-z_]+)\s*\}\}/.exec(tokenString)?.[1]
    if (!key) return

    const selection = window.getSelection()
    let range
    if (selection && selection.rangeCount > 0 && el.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0)
    } else {
      range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
    }
    range.deleteContents()

    const frag = document.createDocumentFragment()
    if (caretNeedsLeadingSpace(range)) frag.appendChild(document.createTextNode(" "))
    frag.appendChild(makeChip(key))
    const anchor = document.createTextNode(ZWS)
    frag.appendChild(anchor)
    range.insertNode(frag)

    const newRange = document.createRange()
    newRange.setStartAfter(anchor)
    newRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(newRange)

    emitChange()
  }

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") return
    e.preventDefault()
    if (!isTextarea) {
      e.currentTarget.closest("form")?.requestSubmit()
      return
    }
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const br = document.createElement("br")
    range.insertNode(br)
    const newRange = document.createRange()
    newRange.setStartAfter(br)
    newRange.collapse(true)
    selection.removeAllRanges()
    selection.addRange(newRange)
    emitChange()
  }

  const shared = cn("m-0 w-full border-none bg-transparent p-0 outline-none", className)

  return (
    <div className={cn("relative", wrapperClassName)}>
      <div
        ref={editableRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onKeyDown={handleKeyDown}
        role="textbox"
        aria-multiline={isTextarea}
        aria-label={placeholder}
        className={cn(shared, "text-foreground", isTextarea ? "min-h-[1em] whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-nowrap")}
      />
      {!value && placeholder && (
        <span className={cn(shared, "pointer-events-none absolute inset-0 text-mauve-6")}>{placeholder}</span>
      )}
    </div>
  )
})

export default HighlightedTemplateField
