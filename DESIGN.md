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
  focus-ring: "#bcbac7"
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
    fontSize: "10px"
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
- Tiny uppercase tracked labels (10–11px bold) as the connective tissue of every record
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
- **Focus Grey** (`focus-ring`, mauve-8): the `ring` token. Focus is neutral, never red.
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
- **Display** (900, 1.875rem → 2.25rem at `md`, tight tracking): page titles in **PageHeader** only. The last word may take Signal Red.
- **Headline** (900, 1.25rem → 1.5rem): section headers inside a page.
- **Title** (500–600, 1rem): card titles, modal titles.
- **Body** (500, 0.875rem; 13px in dense lists): record content, descriptions (max width ~42rem in headers).
- **Label** (700–900, 10–11px, uppercase, `tracking-wider`/`tracking-widest`): field keys, status badges, sidebar group names, date-picker headers. This is the most-used style in the app and appears in roughly 150 files.
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
- **StatusBadge:** a pill (2px 8px) in the card color with a status-colored border and text, 10px bold uppercase tracked. Mauve is the fallback for unknown statuses.
- **PropertyPill:** a round pill with a border, 12px medium muted text. It darkens on hover, and its active state takes the muted fill and semibold text.

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

Each heading below is a stable anchor for lint messages. Paths are under `src/components/`.

#### Button
`ui/button.jsx`. Replaces raw `<button>`. Props: `variant` (`default` | `outline` | `secondary` | `ghost` | `destructive` | `link`), `size` (`default` | `xs` | `sm` | `lg` | `icon` | `icon-xs` | `icon-sm` | `icon-lg`), `asChild`, `className`, plus native button props.

#### Dialog
`ui/dialog.jsx` (base-ui). Replaces hand-rolled full-screen modals. Parts: `Dialog`, `DialogTrigger`, `DialogContent` (`showCloseButton`, `className`), `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogClose`.

#### Drawer
`ui/drawer.jsx` (base-ui Dialog). Side panel that slides in over a dimmed backdrop, for panels that are not centered dialogs (notifications, mobile navigation). Focus trap, Escape and backdrop click call `onOpenChange(false)`. Props: `open`, `onOpenChange`, `side` (`right` | `left`), `className` (width etc.). Parts: `Drawer`, `DrawerTitle`, `DrawerClose`. Use Dialog for anything centered.

#### ConfirmDialog
`ui/ConfirmDialog.jsx`. Dialog preset for confirm/cancel. Props: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel`, `tone`, `onConfirm`, `confirmDisabled`, `children`.

#### Input
`ui/input.jsx`. Replaces raw `<input>` (text, number, date). Props: `label`, `error`, `icon`, `type`, `containerClassName`, `labelClassName`, plus native input props. Checkbox and file pickers have their own Primitives (Checkbox, FileInput).

#### FileInput
`ui/FileInput.jsx`. Replaces raw `<input type="file">`. Owns the hidden input and, when given children, the trigger button. Props: `accept`, `multiple`, `disabled`, `title`, `onFiles(files: File[])`, `variant`/`size` (trigger Button), `className`, `ref`. With no children it renders only the hidden input: attach a `ref` and call `ref.current.click()` from a trigger elsewhere. The input clears after each pick, so choosing the same file again fires again.

#### Textarea
`ui/textarea.jsx`. Replaces raw `<textarea>`. Native textarea props.

#### MentionTextarea
`ui/MentionTextarea.jsx`. Textarea with `@` people suggestions; `mentions` ride beside plain-text `value`. Also exports `NoteText` to render a note with mentions.

#### Switch
`ui/switch.jsx`. On/off toggle. Props: `size`, plus base-ui switch props (`checked`, `onCheckedChange`, `disabled`).

#### Checkbox
`ui/checkbox.jsx` (base-ui). Replaces raw `<input type="checkbox">`. Props: `checked`, `onCheckedChange(checked)`, `disabled`, `readOnly`, `aria-label`, `className`. Wrap in a label (or set `aria-label`) to name it. Distinct from **Switch**, which is an on/off setting.

#### Select
`ui/select.jsx`. Replaces raw `<select>`. Simple form: `<Select options={[{ value, label, disabled? }]} value onChange placeholder disabled size id name aria-label className />`; `onChange` gets the option's `value`. Works inside a Dropdown popover (picking does not close the outer popover). For grouping or custom items compose the base-ui parts: `SelectRoot`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`.

#### FieldBox
`ui/FieldBox.jsx`. The form-field Primitive: a caption plus its control. Replaces raw `<label>` for a caption above a field. The caption is a real label tied to the control (it sets the single child's `id`, or takes `htmlFor`). Props: `label`, `bare` (caption only, for controls that draw their own border like Input, Select, Textarea), `isEditing`, `noBorder` (boxed variant), `htmlFor`, `className`, `labelClassName`. A heading that names no control is not a label: use a `<p>` or `<span>`.

#### SwitchField / CheckboxField
`ui/ToggleField.jsx`. A setting row where the whole row is the click target and the text names the control. Replaces a raw `<label>` wrapping a Switch or Checkbox. `SwitchField`: `label`, `description`, `variant` (`card` | `inline`), plus Switch props. `CheckboxField`: `label`, `labelClassName`, plus Checkbox props.

#### Dropdown
`ui/Dropdown.jsx`. Trigger-plus-children popover or menu, no options or value, not a select. Props: `trigger`, `children`, `isOpen`, `onToggle`, `onClose`, `placement`, `popoverClassName`, `usePortal`, `disabled`. Nested Dropdowns are DOM siblings, handled by its nesting context.

#### FilterDropdown
`ui/FilterDropdown.jsx`. Filter parts for use inside Dropdown: `FilterTrigger` (`label`, `isActive`, `isOpen`, `icon`), `FilterOptionList` (`options`, `value`, `onChange`, `close`), `MultiFilterOptionList` (`options`, `values`, `onChange`).

#### PeoplePicker
`ui/PeoplePicker.jsx`. Multi-select of groups, teams, employees. Props: `value`, `onChange`, `types`, `allowRoles`, `placeholder`, `disabled`.

#### TabGroup
`ui/TabGroup.jsx`. Tabs. Props: `tabs`, `activeTab`, `onChange`, `variant` (`pill` | `primary` | colored | `underline`), `size`, `fullWidth`.

#### Table
`ui/table.jsx`. Replaces raw `<table>`. Styling only: `Table` (wrapper scrolls horizontally; `className` goes to the table, `containerClassName` to the wrapper), `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`. Every other prop passes through, so screens keep their own sorting (`onClick` on `TableHead`), row clicks, pagination and selection (`data-state="selected"` on `TableRow`). Keep only width, alignment and interaction classes; the Primitive owns padding, header type and dividers.

#### Card
`ui/card.jsx`. Parts: `Card` (`size`), `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`.

#### PropertyPill
`ui/PropertyPill.jsx`. Round pill button for a property or filter. Props: `children`, `onClick`, `isActive`, `isOpen`, `icon`, `disabled`.

#### StatusBadge
`StatusBadge.jsx` (root). Status pill. Props: `status`, `label`, `theme`, `children`.

#### TagPill
`ui/TagPill.jsx`. Tag chip. Props: `tag` (`name`, `color`, `archived_at`).

#### Dot
`ui/Dot.jsx`. Small status dot. Props: `size`, `color` (Tailwind classes).

#### ExternalLink
`ui/ExternalLink.jsx`. Replaces raw `<a>` to another site. Always `target="_blank"` with `rel="noopener noreferrer"`. Props: `href`, `className`, `children`, plus native anchor props. Underlined by default; add `no-underline` for chip or thumbnail links. Internal links use the router `Link` (`to`), never `<a>`.

#### Avatar
`Avatar.jsx` (root). The Primitive for people images. Props: `name`, `src`, `size` (`xxs`..`xl`), `isSelected`, `showCheckOnSelect`, `onClick`. Replaces raw `<img>` of a person. Fixed size scale only; use `Image` when you need another size.

#### Image
`ui/Image.jsx`. Thin `<img>` for anything that is neither a person nor an upload (banners, logos, previews, thumbnails inside an upload UI). No transforms, no URL rewriting. Props: `src`, `alt` (always set; `""` if decorative), `className`, plus native img props.

#### ImageAttachment
`ImageAttachment.jsx` (root). The Primitive for uploaded images. Props: `taskId`, `userId`, `attachments`, `onChange`, `readOnly`. Replaces raw `<img>` and file input for uploads.

#### Attachments
`ui/Attachments.jsx`. Attachment picking and display: `AttachmentField` (`label`, `hint`, `attachments`, `disabled`), `AttachmentPreviews`, `AttachmentList`. `AttachmentEvidence` in `ui/AttachmentEvidence.jsx` shows attached evidence.

#### Tooltip
`ui/Tooltip.jsx`. Props: `content`, `side`, `align`, `delay`, `children`.

#### Spinner
`ui/Spinner.jsx`. Props: `size`, `text`, `fullScreen`.

#### Page structure
`ui/PageContainer.jsx` (`maxWidth`, `spaceY`), `ui/PageHeader.jsx` (`title`, `description`, `children`, `lastWordColor`), `ui/SectionHeader.jsx` (`icon`, `title`, `description`, `rangeLabel`), `ui/FilterBar.jsx` (`advancedFilters`, `hasActiveFilters`, `onClearAll`, `actions`).

#### Not built yet
Planned, not available: Table set (`Table`, `TableHeader`, `TableRow`, `TableHead`, `TableCell`, styling only), Checkbox, FileInput (`accept`, `onFiles`), Image, ExternalLink (internal links use the router `Link`), simple Select. Until each lands, ask the maintainer.

## Do's and Don'ts

### Do:
- **Do** write color as Radix steps or semantic tokens (`bg-muted`, `border-mauve-6`, `text-muted-foreground`) so dark mode follows for free.
- **Do** reserve Signal Red for the primary or destructive action on a surface and for the selected canvas edge (ADR 0009, `no-primary-decoration`).
- **Do** use a Primitive from the catalog above, never raw HTML for a covered element. If none fits, stop and ask.
- **Do** label record fields with the 10–11px bold uppercase tracked label, and set audited figures (amounts, record numbers, `vX.Y`) in monospace.
- **Do** keep motion between 150 and 400ms on `cubic-bezier(0.16, 1, 0.3, 1)`, and keep the global reduced-motion guard intact.

### Don't:
- **Don't** use red for focus rings, hover tints, or decorative backgrounds. Focus is neutral grey (mauve-8).
- **Don't** copy the Card component's **indigo-tinted shadow** (`rgba(79,70,229,…)`). It is template drift from a stock theme and not part of this system; shadows here are neutral black.
- **Don't** use `hover:bg-primary-hover`. That token is **not defined**, so the hover silently does nothing. Use the `Button` primary variant, or `hover:bg-red-10`.
- **Don't** reach for **Russo One** or **Inter**. Both are imported in `src/index.css` but unused. Plus Jakarta Sans is the only screen face.
- **Don't** write hex literals or `dark:` overrides for colors the Radix scale already swaps.
- **Don't** reuse the printed TG-11/TG-12 forms' warm-neutral ink system (defined in `src/lib/pdf/htmlPrinter.js`) on screen, and don't bring screen color into print.
