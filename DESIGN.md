---
name: T3CKGROUP ERP
description: Neutral mauve work surface for an internal ERP; red is reserved for the action that has consequences.
colors:
  brand-red: "#e5484d"
  brand-red-deep: "#dc3e42"
  brand-red-ink: "#ce2c31"
  brand-red-wash: "#feebec"
  desk: "#fdfcfd"
  desk-raised: "#faf9fb"
  desk-muted: "#f2eff3"
  desk-hover: "#eae7ec"
  seam: "#e3dfe6"
  border: "#dbd8e0"
  focus-ring: "#65636d"
  ink-faint: "#8e8c99"
  ink-muted: "#65636d"
  ink: "#211f26"
  status-green: "#30a46c"
  status-amber: "#ffc53d"
  status-blue: "#0090ff"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.375
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.05em"
  figure:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  sm: "7.2px"
  md: "9.6px"
  lg: "12px"
  xl: "16.8px"
  2xl: "21.6px"
  full: "9999px"
spacing:
  page-x-mobile: "16px"
  page-x: "40px"
  page-max: "80rem"
  card: "16px"
  card-sm: "12px"
  stack: "24px"
components:
  button-primary:
    backgroundColor: "{colors.brand-red}"
    textColor: "{colors.desk}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-outline:
    backgroundColor: "{colors.desk}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "32px"
  button-ghost-hover:
    backgroundColor: "{colors.desk-muted}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  button-destructive:
    backgroundColor: "{colors.brand-red-wash}"
    textColor: "{colors.brand-red-deep}"
    rounded: "{rounded.lg}"
    height: "32px"
  card:
    backgroundColor: "{colors.desk-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "{spacing.card}"
  status-badge:
    backgroundColor: "{colors.desk-raised}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    typography: "{typography.label}"
  tab-pill-track:
    backgroundColor: "{colors.desk-muted}"
    rounded: "{rounded.xl}"
    padding: "4px"
  tab-pill-active:
    backgroundColor: "{colors.desk-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  nav-item-hover:
    backgroundColor: "{colors.desk-hover}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "6px 10px"
---

# Design System: T3CKGROUP ERP

## Overview

**Creative North Star: "The Operations Desk"**

The system is a calm, neutral work surface where office staff spend a whole business day clearing queues, moving SORs through their Stages, and approving leave. The desk is mauve-grey: warm enough not to feel clinical, quiet enough that eight hours of it doesn't tire anyone. Red is the one loud object on the desk and belongs only on the action with consequences: submit, approve, publish, delete. Everything else is expressed with neutral tone, weight, and position.

Density is moderate to high. A screen carries a heavy page title, a filter row, and then rows of records built from small bold uppercase labels, rounded pills, and bordered cards. Hierarchy comes from extreme weight contrast (black 900 titles over medium 500 body) rather than size alone. Motion is short and confirming: panels open in 150–400ms on an expo-out curve, a success check pops, and every animation drops to near zero under `prefers-reduced-motion`.

Light and dark themes are both first-class. Radix's `.dark` scale swaps every step automatically, so the design is written in scale steps, never in hex, and holds in both.

**Key Characteristics:**
- Mauve neutral field (Radix `mauve` 1–12) and a single brand accent (Radix `red`)
- Plus Jakarta Sans throughout, with weight rather than family carrying hierarchy
- Tiny uppercase tracked labels (11px bold) as the connective tissue of every record
- Softly rounded geometry (12px base radius) and pill-shaped chips
- Flat-leaning surfaces with borders first and small shadows as state
- Dark mode via Radix scale swap, with no per-component color overrides

## Colors

A cool-warm mauve ramp carries the whole interface. One saturated red is reserved for consequence, and Radix status hues appear only inside status badges and tab indicators.

### Primary
- **Signal Red** (`brand-red`, Radix red-9): primary buttons, the selected Flow Canvas edge, notification counts on the sidebar, and the last word of a page title. The brand's own mark (`public/tg-logo.svg`, `#c70908`) is deeper; the UI uses the Radix step so it themes in dark mode.
- **Consequence Red** (`brand-red-deep`, red-10): the `destructive` token. Used as text on a red wash, never as a filled button fill.
- **Red Ink** (`brand-red-ink`, red-11) / **Red Wash** (`brand-red-wash`, red-3): `accent-foreground` / `accent`. Destructive button backgrounds and the date picker's range fill.

### Neutral
- **Desk** (`desk`, mauve-1): page background.
- **Raised Desk** (`desk-raised`, mauve-2): cards, popovers, sidebar.
- **Muted Desk** (`desk-muted`, mauve-3): secondary and muted fills, pill-tab tracks, ghost hover.
- **Hover Desk** (`desk-hover`, mauve-4): sidebar item hover (`sidebar-accent`).
- **Seam** (`seam`, mauve-5): card borders and sidebar border, the quietest structural line.
- **Border** (`border`, mauve-6): input strokes and the global default `border` token.
- **Focus Grey** (`focus-ring`, mauve-11): the `ring` token. Focus is neutral, never red.
- **Faint Ink** (`ink-faint`, mauve-9): disabled glyphs, day-name headers.
- **Muted Ink** (`ink-muted`, mauve-11): descriptions, inactive tabs, secondary text.
- **Ink** (`ink`, mauve-12): primary text.

### Status (badges only)
Green, amber, blue, violet, orange, and red Radix scales are imported for **StatusBadge** and colored **TabGroup** variants. A badge is a card-colored pill with a status-colored border and text, never a filled status block.

### Named Rules
**The One Red Object Rule.** Primary-color utilities (`bg-primary`, `text-primary`, `ring-primary`, `border-primary` and their state modifiers) belong only to components where red carries meaning: buttons, destructive confirmations, the selected canvas edge. Enforced by the `no-primary-decoration` ESLint rule (ADR 0009). If a focus ring, hover tint, or accent background is red, it is wrong.

**The Scale-Step Rule.** Color is written as a Radix step (`mauve-6`, `red-9`) or a semantic token (`border`, `muted`) and never as a hex literal. That is what makes dark mode free.

## Typography

**Display Font:** Plus Jakarta Sans (with sans-serif)
**Body Font:** Plus Jakarta Sans
**Label/Mono Font:** system monospace for audited figures

**Character:** A single geometric-humanist sans used across a very wide weight range. Black-weight titles give the desk its confidence, and medium body text keeps long queues readable.

### Hierarchy
- **Display** (900, 1.875rem → 2.25rem at `md`, tight tracking): legacy large page title. Being removed; compact is the only page title size (see Pages).
- **Headline** (900, 1.25rem → 1.5rem): section headers inside a page.
- **Title** (500–600, 1rem): card titles, modal titles.
- **Body** (500, 0.875rem; 13px in dense lists): record content, descriptions (max width ~42rem in headers).
- **Label** (700–900, 11px, uppercase, `tracking-wider`/`tracking-widest`): field keys, status badges, sidebar group names, date-picker headers. Set it with the `text-label` utility (`--text-label` in `src/index.css`), never a hardcoded `text-[10px]` for an uppercase key label. Other 10px text is out of scope for this rule and is not being migrated here. This is the most-used style in the app and appears in roughly 150 files.
- **Figure** (mono, 12px): record numbers, amounts, and version badges (`vX.Y`) where a machine is accountable for the value.

### Named Rules
**The Weight-Not-Size Rule.** Hierarchy steps by weight first. A title is 900 against a 500 body; don't reach for a bigger size where a heavier weight would do.

**The Label-Is-A-Key Rule.** An uppercase tracked micro-label always names the value beside it and never carries the value itself.

## Layout

Pages sit in a centered `wrapper` (max 80rem, 16px side gutter on mobile, 40px from `sm`). A fixed left **SideNav** (collapsible on desktop, an overlay drawer below `md`) holds navigation. Each page opens with **PageHeader**: the title and description on the left, actions on the right, a bottom border, and 24px of padding beneath. Headers stack vertically below `md`.

Rhythm runs on Tailwind's 4px grid. 24px separates page sections, 16px pads cards (12px for the `sm` size), and 6–10px sits between pills and chips. Desktop is the primary scene (see PRODUCT.md). Mobile is supported but never leads.

Collapsible panels use the `.reveal` grid-rows technique (0fr → 1fr, 320ms) so the content stays mounted and animates to its natural height.

## Elevation & Depth

The desk is flat-leaning. Depth comes first from tonal steps (desk → raised desk → muted desk) and a 1px mauve border. Shadows are small and mostly signal state. A card lifts on hover, a primary button carries `shadow-sm`, and popovers and menus float with `shadow-lg`. Modals sit over a 20% black backdrop blurred 8px.

### Shadow Vocabulary
- **Resting control** (`shadow-sm`): primary buttons, pill-tab active indicator, sidebar toggles.
- **Floating menu** (`shadow-lg`): dropdown and sidebar popover menus.
- **Date picker** (`0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -2px rgba(0,0,0,.05)`): the one hand-tuned floating panel.
- **Handle halo** (`0 0 0 4px mauve-a4` → `0 0 0 6px red-a5` on hover): Flow Canvas connection handles. A ring instead of a scale, because React Flow owns the handle's transform.

### Named Rules
**The Border-Before-Shadow Rule.** Separate with a mauve-5/6 border first. Add a shadow only when the surface floats (menu, popover, modal) or is responding to the pointer.

## Shapes

The shapes are soft rounded rectangles on a 12px base radius (`--radius: 0.75rem`), scaled by multipliers: sm 7.2px, md 9.6px, lg 12px, xl 16.8px, 2xl 21.6px. Controls (buttons, inputs, nav items, tab buttons) use `lg`. Cards, tab tracks, and menus use `xl`. Hero containers and large modals use `2xl`. Badges, pills, avatars, and count bubbles are fully round. There are no sharp corners on screen.

## Components

### Buttons
Compact, confident, and quiet unless they are *the* action.
- **Shape:** gently rounded (12px), 32px tall by default (24 / 28 / 36px for xs / sm / lg), 14px medium text, 16px icons.
- **Primary:** Signal Red fill with Desk text and `shadow-sm`. It lifts 2px on hover and presses 1px down on active.
- **Outline:** Desk fill with a mauve border, shifting to Muted Desk on hover.
- **Ghost:** transparent, shifting to Muted Desk on hover.
- **Destructive:** Red Wash at 10% with Consequence Red text. Red is carried by the text, not a solid fill.
- **Focus:** a neutral 3px ring at `ring/50`, never red.
- **Disabled:** 50% opacity with no pointer events.

### Chips and badges
- **StatusBadge:** a pill (2px 8px) in the card color with a status-colored border and text, 11px bold uppercase tracked (`text-label`). Text uses Radix step 11 (step 12 for green, amber, and orange, which fall short of 4.5:1 at 11) so it passes 4.5:1 on the card. Mauve is the fallback for unknown statuses.
- **PropertyPill:** a round pill with a border, 12px medium muted text. It darkens on hover, and its active state takes the muted fill and semibold text.
- **State dot:** a small `Dot` (6–8px) may sit beside text in list rows and tabs to show state. It is never a pill: StatusBadge stays the only status pill. The dot always sits beside a visible state word and never carries the state alone.

### Cards / Containers
- **Corner Style:** 16.8px (`xl`).
- **Background:** Raised Desk with a Seam border.
- **Shadow Strategy:** small at rest, lifting 4px with a larger shadow on hover (see Don'ts on its tint).
- **Internal Padding:** 16px (12px for `sm`). Footers sit on a `muted/50` band with a top border.

### Inputs / Fields
- **Style:** a Border (mauve-6) stroke on Desk with a 12px radius, and 14px text to match buttons.
- **Focus:** the border shifts to Focus Grey with a 3px neutral ring.
- **Error:** `aria-invalid` switches the border to Consequence Red with a 20% red ring.

### Tabs (TabGroup)
- **Pill (default):** a Muted Desk track (4px padding, `xl`) with a Raised Desk indicator that slides under the active tab (framer-motion). Labels are 12px bold.
- **Primary / colored:** a card track with a border and a filled indicator (red, green, or violet) with a tinted shadow. Reserve this for the one tab bar on a page that switches the whole working mode.
- **Underline:** a 2px mauve-10 underline, used in the notification drawer.
- **Keyboard:** arrow keys, Home, and End move focus with roving tabindex, following ARIA tabs.

### Navigation (SideNav)
Raised Desk panel with a Seam right border. Group names are 11px black uppercase `tracking-widest` labels. Items are 13px semibold on a 12px radius, with Hover Desk on hover. Unread counts are round Signal Red bubbles with a sidebar-colored ring. Below `md` the nav becomes a drawer over a 40% black scrim.

### Flow Canvas (signature)
React Flow chrome is re-themed from the same tokens so the canvas belongs to the system in both themes. Controls and the minimap sit on Raised Desk with a mauve-6 outline and no shadow. An edge thickens to 2.5px mauve-11 on hover and turns Signal Red when selected. The connection line is dashed red. The selected edge is one of the sanctioned red objects, because Delete acts on it.

### Primitive catalog

A **Primitive** is anything in `src/components/ui/`. Raw `<button>`, `<input>`, `<textarea>`, `<select>`, `<label>`, `<table>`, `<img>`, `<a>` and hand-rolled full-screen modals are banned outside that folder (ADR 0025). One Primitive per job. `<form>`, layout tags, paragraphs and headings are not covered. **If nothing here fits, stop and ask the maintainer.** Never disable the lint rule.

Headings are stable anchors; a lint message links to the heading of the Primitive it asks for. Paths are under `src/components/`.

#### Button
`ui/button.jsx`. Replaces raw `<button>`. Props: `variant` (`default` | `outline` | `secondary` | `ghost` | `destructive` | `link`), `size` (`default` | `xs` | `sm` | `lg` | `icon` | `icon-xs` | `icon-sm` | `icon-lg`), `asChild`, `className`, plus native button props.

#### Dialog
`ui/dialog.jsx` (base-ui). Replaces hand-rolled full-screen modals. Parts: `Dialog`, `DialogTrigger`, `DialogPortal`, `DialogOverlay`, `DialogContent` (`showCloseButton`, `className`), `DialogHeader`, `DialogFooter` (`showCloseButton`), `DialogTitle`, `DialogDescription`, `DialogClose`.

#### Drawer
`ui/drawer.jsx` (base-ui dialog). Side panel: notification drawer, mobile sidebar. Same focus trap, Escape and backdrop click as Dialog. Parts: `Drawer` (`open`, `onOpenChange`), `DrawerTrigger`, `DrawerContent` (`side`: `right` | `left`, `className`), `DrawerTitle`, `DrawerDescription`, `DrawerClose`. No built-in close button; add `DrawerClose`.

#### SlideOver
`ui/SlideOver.jsx`, on Drawer. The record slide-over (DESIGN.md "Pages → Container rule"). Props: `record` (null = closed), `icon`, `crumb` (closes back to the list), `identity(record)` → `{ ref, title, badge, subtitle }`, `index`, `total` (position count; arrows and count hidden when `total` is 1 or omitted), `onStep(±1)` (buttons and J / K), `onClose`, `onOpenFull(record)` (button shown only when given), `openFullLabel` (its aria-label, default "Open full"), `children(record)`. Parts: `SlideOverBody` (scrolls), `SlideOverFooter` (pinned decision). Pair with `hooks/useRecordParam` so the open record lives in `?record=`.

#### DetailParts
`ui/DetailParts.jsx`. Record detail parts for slide-over bodies: `DetailSection` (`title`, `aside`), `DetailRow` (`label`), `NotePresets` (`presets`, `onPick`), `ApprovalChain` (`chain` of `{ label, who, note, at, state }`), `PersonChip` (`person`, `size`, `detail`).

#### RecordModal
`ui/record-modal.jsx`, on Dialog. The one-size modal for the records that carry a Chat (SOR, Individual Task, Group Task; DESIGN.md "Pages → Container rule"). `RecordModalContent` replaces `DialogContent` (`className`, plus DialogContent props); `RECORD_MODAL_CLASS` is its size. No size switcher.

#### ConfirmDialog
`ui/ConfirmDialog.jsx`. Dialog preset for confirm/cancel. Props: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `tone`, `onConfirm`, `confirmDisabled`, `className`, `footerClassName`, `children`. `ui/approveClass.js` exports `APPROVE_CLASS`, the green Approve style for a `Button` that approves outside a ConfirmDialog (record footers, the Decision card).

#### Input
`ui/input.jsx`. Replaces raw `<input>` (text, number, date). Props: `label`, `error`, `icon`, `type`, `containerClassName`, `labelClassName`, plus native input props. Checkbox and file inputs have their own Primitives.

#### Textarea
`ui/textarea.jsx`. Replaces raw `<textarea>`. Native textarea props. `variant="bare"` strips border, background, padding and ring for inline-edit fields inside a bordered card.

#### MentionTextarea
`ui/MentionTextarea.jsx`. Textarea with `@` people suggestions; `mentions` ride beside plain-text `value`. Props: `value`, `onChange`, `people`, `mentions`, `onMentionsChange`, `placeholder`, `rows`, `className`, `containerClassName`, `onPaste`, `disabled`, `maxLength`, `onEnterSubmit`. Also exports `NoteText` (`content`, `mentions`, `className`, `onMentionClick`) to render a note with mentions.

#### Switch
`ui/switch.jsx`. On/off toggle. Props: `size`, plus base-ui switch props (`checked`, `onCheckedChange`, `disabled`).

#### Checkbox
`ui/checkbox.jsx`. Replaces raw `<input type="checkbox">`; a tick box, not the on/off Switch. Props: `tone` (`primary`, the default; `neutral`, a mauve-12 tick for a neutral surface), plus base-ui checkbox props (`checked`, `onCheckedChange`, `disabled`). Wrap in a label for a text target, or pass `aria-label`.

#### FileInput
`ui/FileInput.jsx`. Replaces raw `<input type="file">`; owns the hidden input and its trigger. Props: `accept`, `multiple`, `disabled`, `onFiles(files[])`, `onCancel`, `variant`/`size`/`className` and any other props for the trigger Button. With `children` it renders a Button trigger; without, only the hidden input, opened via `ref.current.open()` from a trigger elsewhere.

#### Select (base-ui building blocks)
`ui/select.jsx`. Parts: `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`. Building blocks for `SelectField`; use those directly only for custom triggers/items. Look matches the Category/Priority Dropdowns and `FilterTrigger`/`FilterOptionList`: bordered card trigger (`h-[46px]`, `size="sm"` is `h-9`) with rotating chevron and mauve ring when open; `bg-muted` rounded-xl popover; semibold items, selected item `bg-muted/80` bold with a muted check.

#### SelectField
`ui/SelectField.jsx`. Replaces raw `<select>`. Props: `options` (`{value,label,disabled?}`), `value`, `onChange(value)`, `placeholder`, `disabled`, `size`, `className`, `contentClassName`. Works inside Dropdown popovers: its list registers with the Dropdown nesting context (`useDropdownNestedPopoverRef` in `ui/dropdownNesting.js`), otherwise the outer popover closes on mousedown before the pick registers.

#### FieldBox
`ui/FieldBox.jsx`. Form-field Primitive, label plus control. Replaces raw `<label>`. Props: `label`, `isEditing`, `noBorder`, `bare`, `inline`, `htmlFor`, `className`, `children`. Default: caption above a bordered control box; `bare`: caption above children, no box; no children: caption only (pass `htmlFor`); `inline`: label wraps children, for checkbox and switch rows. A lone child control is associated with the label automatically.

#### Table
`ui/table.jsx`. Replaces raw `<table>`. Styling-only set: `Table` (wraps in a horizontal scroll container), `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`. Native table props plus `className`. Sorting, pagination and selection stay in feature code. Opt-in column resize: give `Table` a `tableId` and a `TableHead` an `id` and that column gets a drag handle (double-click resets it); widths are saved per user and table in localStorage. Use it on page-level Registers and Queues, not on small embedded tables. `SortHead` is a `TableHead` you tap to sort (up/down arrows, `aria-sort`); pair it with the `useTableSort` hook, which sorts ascending, then descending, then back to the original order. On touch screens the resize handle widens to 24px, and a "Reset columns" button shows once widths are saved. Opt-in `scrollCue` fades the edge that still has columns off-screen (none when the table fits); used on the admin tables that stay desktop-width.

#### Dropdown
`ui/Dropdown.jsx`. Trigger-plus-children popover or menu, no options or value, not a select. Props: `trigger`, `children`, `isOpen`, `onToggle`, `onClose`, `placement`, `className`, `popoverClassName`, `usePortal`, `disabled`. Nested Dropdowns are DOM siblings, handled by its nesting context (`ui/dropdownNesting.js`: `DropdownNestingContext`, `useDropdownNestedPopoverRef`, the hook for any popover portalled out of a Dropdown).

#### FilterDropdown
`ui/FilterDropdown.jsx`. Filter parts for use inside Dropdown: `FilterTrigger` (`label`, `isActive`, `isOpen`, `icon`, `disabled`, `count` (badge of active filters), `className`, `labelClassName` (e.g. `hidden sm:block` to collapse to icon; the trigger keeps its `aria-label`)), `FilterOptionList` (`options`, `value`, `onChange`, `close`), `MultiFilterOptionList` (`options`, `values`, `onChange`).

#### PeoplePicker
`ui/PeoplePicker.jsx`. Multi-select of groups, teams, employees. Props: `value`, `onChange`, `types`, `allowRoles`, `placeholder`, `disabled`, `className`.

#### TabGroup
`ui/TabGroup.jsx`. Tabs. Props: `tabs`, `activeTab`, `onChange`, `variant` (`pill` | `primary` | `success` | `violet` | `red` | `destructive` | `underline`), `size`, `fullWidth`, `className`, `labelClassName` (e.g. `hidden sm:inline` to collapse to icons; tabs keep their `aria-label`), `id`.

#### Card
`ui/card.jsx`. Parts: `Card` (`size`), `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`.

#### PropertyPill
`ui/PropertyPill.jsx`. Round pill button for a property or filter. Props: `children`, `onClick`, `isActive`, `isOpen`, `icon`, `disabled`, `className`.

#### StatusBadge
`StatusBadge.jsx` (root). Status pill. Props: `status`, `label`, `theme`, `children`.

#### Dot
`ui/Dot.jsx`. Small status dot. Props: `size`, `color` (Tailwind classes), `className`, plus native span props.

#### Avatar
`Avatar.jsx` (root). The Primitive for people images. Props: `name`, `src`, `size` (`xxs`..`xl`), `isSelected`, `showCheckOnSelect`, `onClick`. Replaces raw `<img>` of a person.

#### ImageAttachment
`ImageAttachment.jsx` (root). The Primitive for uploaded images. Props: `taskId`, `userId`, `attachments`, `onChange`, `readOnly`. Replaces raw `<img>` and file input for uploads.

#### Attachments
`ui/Attachments.jsx`. Attachment picking and display: `AttachmentField` (`label`, `hint`, `attachments`, `disabled`), `AttachmentPreviews` (`files`, `onRemove`, `disabled`), `AttachmentList` (`attachments`, `className`, `compact`). `AttachmentEvidence` in `ui/AttachmentEvidence.jsx` (`attachments`, `className`) shows attached evidence with a viewer.

#### Tooltip
`ui/Tooltip.jsx`. Props: `content`, `side`, `align`, `delay`, `className`, `children`.

#### PageShell
`ui/PageShell.jsx`. The Page skeleton (ADR 0029). Props: `title`, `description`, `action`, `banner` (above the header; only the Dashboard's greeting), `tabs`, `toolbar`, `body` (or `children`), `frame` (`centred` | `narrow` | `full`), `className`. Slots render in fixed order; wraps `ui/PageContainer.jsx` and `ui/PageHeader.jsx` (compact-only title, last word red). Every routed Page renders it, and PageHeader renders nowhere else (`local/require-page-shell`, see "Pages → PageShell").

#### ReportFigure
`ui/ReportFigure.jsx`. The Report layout's headline figure: big figure with its note, supporting stats, chart beside them. Props: `label`, `figure`, `note`, `stats` (`{ label, value, sub, tone, onClick }`; `onClick` makes the stat a button with an arrow; a zero dims; `tone: "attention"` turns a non-zero value amber-11), `chart`, `className`. Every part is optional, so a row of counts is `stats` alone; that row gets 2xl numerals, hairline dividers from `lg`, and a bottom hairline (the Page header's rule is its top). Replaces gradient summary cards.

#### EmptyState
`ui/EmptyState.jsx`. The one empty state: muted icon, title, one line. Props: `icon`, `title`, `description`, `className`.

#### QueryError
`ui/QueryError.jsx`. The one query-failure block: short message plus Retry; never prints a raw error. Props: `title`, `onRetry`, `className`.

#### Spinner
`ui/Spinner.jsx`. Props: `size`, `text`, `fullScreen`, `className`.

#### CustomToast
`ui/CustomToast.jsx`. Toast body for react-hot-toast. `CustomToast` props: `t`, `title`, `description`, `variant` (`default` | `success` | `error` | `loading` | `info` | `confirm`), `onConfirm`, `onCancel`, `confirmText`, `cancelText`; renders `t.action` (`{ label, onClick }`) when set. Helpers: `confirmDeleteToast(title, description, onConfirm)`, `confirmActionToast(title, description, confirmText, actionType, onConfirm)`, `undoableSuccessToast(message, label, onUndo, duration)`.

#### EmojiPicker
`ui/EmojiPicker.jsx`. Emoji button plus popup grid with recents. Props: `onSelect(emoji)`, `className`, `align`, `disabled`.

#### HighlightedTemplateField
`ui/HighlightedTemplateField.jsx`. Single-line or multi-line field that shows `{{token}}` as chips while typing (task templates). Props: `as` (`input` | `textarea`), `value`, `onChange`, `className`, `wrapperClassName`, `placeholder`, `name`. `onChange` gets `{ target: { name, value } }`. The ref exposes `focus()` and `insertToken(tokenString)`.

#### TemplateTokenText
`ui/TemplateTokenText.jsx`. Read-only template text with `{{token}}` masked as chips. Props: `text`, `chipClassName`.

#### TemplateVariableChips
`ui/TemplateVariableChips.jsx`. Insert-at-caret chips for template variables, plus a preview card. Props: `value`, `onInsert(tokenString)`, `className`.

#### ReplyPreviewBar
`ui/ReplyPreviewBar.jsx`. Bar above the chat composer for the message being replied to. Props: `replyingTo` (`authorName`, `content`), `onCancel`, `className`.

#### ReplyQuote
`ui/ReplyQuote.jsx`. Quoted snippet inside a chat bubble sent as a reply. Props: `replyTo` (`authorName`, `content`), `className`.

#### SwipeToReplyWrapper
`ui/SwipeToReplyWrapper.jsx`. Wraps one chat bubble: swipe-to-reply and long-press reactions on touch, hover reply button on desktop. Props: `children`, `onReply`, `onReact(emoji)`, `isMe`, `className`.

#### SorLinkChip
`ui/SorLinkChip.jsx`. Pill on a task row linked to an SOR; opens the SOR. Props: `opportunityId`, `opportunity`, `className`.

#### SorQuickLinkButton
`ui/SorQuickLinkButton.jsx`. Icon-only SOR link for the task card footer; opens Quick View. Props: `opportunityId`, `className`.

#### SaveDefaultButton
`ui/SaveDefaultButton.jsx`. "Save filters as default" control for a filter bar: Save / Default saved (with clear) / Update default (with clear) once the filters drift. Pair with `useSavedFilters`. Props: `hasSavedDefault`, `isDirty`, `onSave`, `onClear`, `className`.

#### Page structure
`ui/PageContainer.jsx` (`maxWidth`, `spaceY`, `className`), `ui/PageHeader.jsx` (`title`, `description`, `children`, `showGradient`, `lastWordColor`, `className`), `ui/SectionHeader.jsx` (Sentence-case `title`, `description`, `rangeLabel`, `children`, `className`), `ui/FilterBar.jsx` (one line: `search` `{value, onChange, placeholder}`, `chips` (up to three `FilterSelect`s), `filters` (the Filters popover body, a node or `({close}) =>`), `activeCount` (badge on Filters), `saveDefault` (SaveDefaultButton props), `actions`, `hasActiveFilters` + `onClearAll` (Clear all), `className`). Companions: `FilterSelect` and `FilterTriggerButton` in `ui/FilterDropdown.jsx` (a whole single-choice filter: `options`, `value`, `onChange`, `icon`, `label`, `allValue`, `disabled`), and `ui/PeriodFilter.jsx` (`timeframe`, `onTimeframeChange`, `value`, `onChange`; a Daily/Weekly/Monthly/Yearly chip with its date).

#### Image
`ui/image.jsx`. Thin `<img>` wrapper, no transforms. Props pass through (`src`, `alt`, `className`). Use for non-person, non-upload images; people use Avatar, uploads use ImageAttachment.

#### ExternalLink
`ui/external-link.jsx`. Anchor for outside URLs; always `target="_blank"` with `rel="noopener noreferrer"` (caller `rel` is merged). Internal links use the router `Link`.

#### PageLoading
`ui/PageLoading.jsx`. The one page/section loading state: spinner plus sentence-case "Loading X…". Props: `label` (the noun, e.g. "task approvals", not the sentence), `className`.

#### ChatScroller
`ui/ChatScroller.jsx`. Scrolling body of a Chat that loads older Messages at the top, keeps your place when they arrive, and parks new Messages behind a "New messages" pill unless you were at the bottom. Props: `firstKey`/`lastKey` (ids of oldest/newest loaded Message) plus paging callbacks; drive with `usePagedChat`.

#### TablePager
`ui/TablePager.jsx`. List footer: "Showing X to Y of N", rows-per-page select, Prev / Next. Drive with `usePaging`: `<TablePager {...paging} noun="tasks" />`. Props: `total`, `page`, `pageSize`, `totalPages`, `setPage`, `setPageSize`, `noun`, `children` (far end of the bar), `className`.

#### DesktopNotice
`ui/DesktopNotice.jsx`. "Best on desktop" note for admin and config surfaces not built for a phone; visible below `md` only. Props: `children` (default "This page is best on desktop."), `className`.

## Pages

Every routed screen is built from one skeleton (ADR 0029). This section is the rulebook; the Primitive catalog above lists the parts.

### Vocabulary
- **Page**: one sidebar entry; one routed screen.
- **Page type**: one of five presets a Page declares.
  - **Queue**: work to clear. Table + slide-over + decision footer.
  - **Register**: browse and search records.
  - **Report**: read-only figures.
  - **Config**: settings rows and forms in a narrow centred column.
  - **Tool**: custom full-width surface.

These are UI terms. They do not belong in CONTEXT.md.

### Route → page type
- **Queue**: Task Approvals, HR Verifications, Leave Approvals, IPAS Sign-offs (`/approvals/ipas`), Transmittal Check by (`/approvals/transmittals`; the five Approval Center routes), Procurement Queue, Bug Reports, Leaves Manager (level-1 tabs switch its views; Pending and Request History take the type pills as level 2).
- **Register**: SOR Register (List / Board), All Tasks, Group Tasks, Task Templates, HR Management → Employees, My Requests, My SORs, Activity Log, IPAS (`/purchasing/ipas`; each IPAS opens as its own record page at `/purchasing/ipas/[id]`, the Decider layout: the overview holds the figures and the sections as rows, with a "Your move" decision card beside them (the chain sits behind a toggle below the wide breakpoint). A section opens in a slide-over drawer with its moves pinned in the footer; a section's edit view replaces the overview in the page, at `?edit=`). Transmittals (`/purchasing/transmittals`; each slip opens as its own record page at `/purchasing/transmittals/[id]`, and Raise Transmittal at `/purchasing/transmittals/new` is that record page's draft form), Packing Lists (`/purchasing/packing-lists`, each list at `/purchasing/packing-lists/[id]`).
- **Report**: Commission Dashboard, Retail, Dashboard, SOR Register → Overview view.
- **Config**: Settings (its Purchasing tab holds the IPAS option lists and, for Super Admins, the sign-off lists and the history of who changed them; the old `/purchasing/ipas/settings` redirects there), Profile, HR Management's configuration tabs, the Commission Dashboard's Formula tab (the tab body follows Config rules inside a Report page).
- **Tool**: Flow Canvas, Document Center (a view in the Leaves Manager), Release Notes.
- Redirect-only routes (legacy CRM/opportunities paths, Approval Center index, HR index, Super Admin index, Lead Sources) have no type.

### PageShell
PageShell owns the Page skeleton. A Page fills fixed slots and cannot reorder them:
1. **Header**: compact title, optional description, the one main action.
2. **Level-1 tabs**.
3. **Toolbar**: level-2 pill tabs, filter bar, display toggle.
4. **Body**.

PageShell also owns phone behaviour (header stacks, level-1 tabs scroll sideways, filters fold into the Filters popover, tables scroll sideways) and dark-mode tokens.

**Enforced by lint** (`local/require-page-shell`, ADR 0029). A routed file (under `src/pages/`, no `_` path segment) must render PageShell, render a layout imported from a file that renders it (the Approval Center's `ApprovalCenterLayout`, `CommissionDashboardView`), or render only `<Navigate>` (a redirect route). Rendering PageHeader anywhere outside PageShell fails. The screens outside the app frame (login, password reset, verify) are not Pages. The rule can't be disabled inline, and `pnpm lint:primitives` (CI) fails on it. A component that is not a Page does not belong in a routed file: put it in a `_components/` folder.

### Frames
- **Centred** (default): the `wrapper`, max 80rem.
- **Narrow**: the Config type's column, max 56rem, centred; header, tabs and body all sit in it.
- **Full-width**: SOR Register, Flow Canvas and flow version pages. Full-width stays an explicit per-route list in the app layout, so a new Page never becomes full-width by accident.
- The Dashboard's greeting banner sits above the standard layout.

### Title
Compact is the only title size, last word in Signal Red. The large variant is removed from PageHeader. The description sits directly under the title on every Page.

### Tab levels
- **Level 1** switches what the Page is about: TabGroup `underline`, optional icon and count.
- **Level 2** switches slices of the same list: TabGroup `pill`.
- **Display toggle** (List / Board / Grid / Table): a small segmented control in the header's action slot, never a tab.
- No page has a left sidebar of its own. Many views stay level-1 tabs (the strip scrolls sideways on phones); facets with counts (Leaves Manager's Type) become level-2 pills.

### Container rule
Pick by what the person is doing.
- **Slide-over** (from the right): looking at or deciding on a record picked from a list. Has previous/next with a position count, "Open full" when a RecordModal exists, a scrolling body, and a pinned decision footer. The open record lives in the URL query. Never holds a long form; longer edits open a modal from it. A record's section drawer (the IPAS record page) omits the position count: its sections are not a list to count through.
- **Modal**: a short make or confirm step ending in Save/Cancel (Register SOR, New Template, Apply Leave / OT, Add Employee, confirmations).
- **RecordModal**: SOR, Individual Task, Group Task, the records that carry a Chat. One size (16px inset, 1400px max width, rounded, dimmed backdrop), no size switcher. Reached from a slide-over's "Open full" or directly where that is the existing entry.

Slide-over covers the Approval Center review, Leaves Manager pending review, SOR Quick View and the locked SOR summary, employee profile / leave balances, Purchase Request review. Slide-overs open full-screen on phones.

### Filter bar
FilterBar is the only filter surface, on one line: search, up to three inline dropdown chips, a Filters popover with an active count, Save as default. No large filter cards.

### Main action
One red Button in the header action slot, standard 32px size, top right. No oversized, uppercase, black or floating variants. Decision footers may also use green (approve / verify) and pale red (return / reject), nowhere else (ADR 0009 amendment).

### List display
Queue and Register bodies are tables (Table Primitive) by default. A card grid exists only as a display toggle, and only where cards carry something a row cannot (All Tasks, Group Tasks).

### Report layout
One headline figure with its supporting stats beside the chart, then the breakdown. The time range control sits in the header's action slot (the Dashboard's uses `FloatingMonthPicker` `inline`). Built from `ReportFigure`. No gradient summary cards.

### Empty state
One form: muted icon, title, one line. No box, no dashed border.

### Status badge
StatusBadge (coloured outline, uppercase) is the only status pill. No dot-pills.

### Section headings
Sentence-case title with an optional one-line description. Uppercase tracked labels are only for field names and table column heads (Label-Is-A-Key Rule).

## Do's and Don'ts

### Do:
- **Do** write color as Radix steps or semantic tokens (`bg-muted`, `border-mauve-6`, `text-muted-foreground`) so dark mode follows for free.
- **Do** reserve Signal Red for the primary or destructive action on a surface and for the selected canvas edge (ADR 0009, `no-primary-decoration`).
- **Do** use a Primitive from the catalog above, never raw HTML for a covered element. If none fits, stop and ask.
- **Do** label record fields with the 11px bold uppercase tracked label, and set audited figures (amounts, record numbers, `vX.Y`) in monospace.
- **Do** keep motion between 150 and 400ms on `cubic-bezier(0.16, 1, 0.3, 1)` (the `ease-out-expo` utility), and keep the global reduced-motion guard intact.

### Don't:
- **Don't** use red for focus rings, hover tints, or decorative backgrounds. Focus is neutral grey (mauve-11).
- **Don't** copy the Card component's **indigo-tinted shadow** (`rgba(79,70,229,…)`). It is template drift from a stock theme and not part of this system; shadows here are neutral black.
- **Don't** use `hover:bg-primary-hover`. That token is **not defined**, so the hover silently does nothing. Use the `Button` primary variant, or `hover:bg-red-10`.
- **Don't** reach for **Russo One** or **Inter**. Both are imported in `src/index.css` but unused. Plus Jakarta Sans is the only screen face.
- **Don't** write hex literals or `dark:` overrides for colors the Radix scale already swaps.
- **Don't** reuse the printed TG-11/TG-12 forms' warm-neutral ink system (defined in `src/lib/pdf/htmlPrinter.js`) on screen, and don't bring screen color into print.
