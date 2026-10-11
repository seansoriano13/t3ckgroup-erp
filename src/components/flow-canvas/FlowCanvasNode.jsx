import { memo, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import {
  AlertTriangle,
  CircleDot,
  Eye,
  EyeOff,
  Flag,
  Octagon,
  Plus,
  ShieldOff,
  Users,
  Globe,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Dropdown from "@/components/ui/Dropdown";
import AddStagePopoverForm from "./AddStagePopoverForm";
import { STAGE_H, STAGE_W } from "./flowCanvasLayout";
import { initialsOf } from "@/utils/stageAudience";
import { endsAsWon } from "@/constants/salesFlow";

/**
 * A Stage on the Flow Canvas.
 *
 * Left and right handles carry the flow itself — the moves a deal may make.
 * The three handles on the bottom edge carry no moves at all: they anchor the
 * Stage's gate (its conditions, hanging below-left), its fields (what it asks
 * the deal to fill in, hanging straight below) and its run (its actions,
 * hanging below-right), so what a Stage *demands* and what it *does* are read
 * off the canvas rather than found by clicking through to a panel.
 *
 * Every handle is named. React Flow resolves an edge that names no handle to
 * whichever source handle it finds first, so an unnamed right-hand output on a
 * node that also carries two bottom anchors is a coin toss — and it lands on
 * the gate anchor, which is why a move used to leave from under the node's
 * bottom-left corner instead of its right edge. IN/OUT are the flow's own
 * handles; GATE/FIELDS/RUN belong to the satellites and are never user-connectable.
 */

export const HANDLE_IN = "in";
export const HANDLE_OUT = "out";

const ROLE = {
  entry: {
    label: "Entry",
    icon: CircleDot,
    tile: "bg-blue-a3 text-blue-11",
    chip: "bg-blue-a3 text-blue-11",
  },
  won: {
    label: "Won",
    icon: Flag,
    tile: "bg-green-a3 text-green-11",
    chip: "bg-green-a3 text-green-11",
  },
  terminal: {
    label: "Terminal",
    icon: Octagon,
    tile: "bg-amber-a3 text-amber-11",
    chip: "bg-amber-a3 text-amber-11",
  },
  plain: {
    label: null,
    icon: CircleDot,
    tile: "bg-mauve-a3 text-mauve-11",
    chip: "",
  },
};

function roleOf({ isEntry, isWon, isTerminal }) {
  if (isEntry) return ROLE.entry;
  if (isWon) return ROLE.won;
  if (isTerminal) return ROLE.terminal;
  return ROLE.plain;
}

/**
 * A Stage's own color (flow_stages.color, migration 20260828090000)
 * overrides the role tile — the icon box only. The Entry/Won/Terminal chips
 * stay role-colored regardless, because they're labeling the role itself,
 * not "what color is this Stage".
 */
const COLOR_TILES = {
  tomato: "bg-tomato-a3 text-tomato-11",
  red: "bg-red-a3 text-red-11",
  crimson: "bg-crimson-a3 text-crimson-11",
  pink: "bg-pink-a3 text-pink-11",
  plum: "bg-plum-a3 text-plum-11",
  violet: "bg-violet-a3 text-violet-11",
  indigo: "bg-indigo-a3 text-indigo-11",
  blue: "bg-blue-a3 text-blue-11",
  sky: "bg-sky-a3 text-sky-11",
  cyan: "bg-cyan-a3 text-cyan-11",
  teal: "bg-teal-a3 text-teal-11",
  jade: "bg-jade-a3 text-jade-11",
  green: "bg-green-a3 text-green-11",
  lime: "bg-lime-a3 text-lime-11",
  yellow: "bg-yellow-a3 text-yellow-11",
  amber: "bg-amber-a3 text-amber-11",
  orange: "bg-orange-a3 text-orange-11",
  gold: "bg-gold-a3 text-gold-11",
  brown: "bg-brown-a3 text-brown-11",
  mauve: "bg-mauve-a3 text-mauve-11",
};

const COLOR_OUTLINES = {
  tomato: "outline-tomato-6 hover:outline-tomato-8",
  red: "outline-red-6 hover:outline-red-8",
  crimson: "outline-crimson-6 hover:outline-crimson-8",
  pink: "outline-pink-6 hover:outline-pink-8",
  plum: "outline-plum-6 hover:outline-plum-8",
  violet: "outline-violet-6 hover:outline-violet-8",
  indigo: "outline-indigo-6 hover:outline-indigo-8",
  blue: "outline-blue-6 hover:outline-blue-8",
  sky: "outline-sky-6 hover:outline-sky-8",
  cyan: "outline-cyan-6 hover:outline-cyan-8",
  teal: "outline-teal-6 hover:outline-teal-8",
  jade: "outline-jade-6 hover:outline-jade-8",
  green: "outline-green-6 hover:outline-green-8",
  lime: "outline-lime-6 hover:outline-lime-8",
  yellow: "outline-yellow-6 hover:outline-yellow-8",
  amber: "outline-amber-6 hover:outline-amber-8",
  orange: "outline-orange-6 hover:outline-orange-8",
  gold: "outline-gold-6 hover:outline-gold-8",
  brown: "outline-brown-6 hover:outline-brown-8",
  mauve: "outline-mauve-6 hover:outline-mauve-8",
};

const COLOR_OUTLINES_SELECTED = {
  tomato: "outline-tomato-9 shadow-[0_14px_32px_-14px_var(--tomato-a6)]",
  red: "outline-red-9 shadow-[0_14px_32px_-14px_var(--red-a6)]",
  crimson: "outline-crimson-9 shadow-[0_14px_32px_-14px_var(--crimson-a6)]",
  pink: "outline-pink-9 shadow-[0_14px_32px_-14px_var(--pink-a6)]",
  plum: "outline-plum-9 shadow-[0_14px_32px_-14px_var(--plum-a6)]",
  violet: "outline-violet-9 shadow-[0_14px_32px_-14px_var(--violet-a6)]",
  indigo: "outline-indigo-9 shadow-[0_14px_32px_-14px_var(--indigo-a6)]",
  blue: "outline-blue-9 shadow-[0_14px_32px_-14px_var(--blue-a6)]",
  sky: "outline-sky-9 shadow-[0_14px_32px_-14px_var(--sky-a6)]",
  cyan: "outline-cyan-9 shadow-[0_14px_32px_-14px_var(--cyan-a6)]",
  teal: "outline-teal-9 shadow-[0_14px_32px_-14px_var(--teal-a6)]",
  jade: "outline-jade-9 shadow-[0_14px_32px_-14px_var(--jade-a6)]",
  green: "outline-green-9 shadow-[0_14px_32px_-14px_var(--green-a6)]",
  lime: "outline-lime-9 shadow-[0_14px_32px_-14px_var(--lime-a6)]",
  yellow: "outline-yellow-9 shadow-[0_14px_32px_-14px_var(--yellow-a6)]",
  amber: "outline-amber-9 shadow-[0_14px_32px_-14px_var(--amber-a6)]",
  orange: "outline-orange-9 shadow-[0_14px_32px_-14px_var(--orange-a6)]",
  gold: "outline-gold-9 shadow-[0_14px_32px_-14px_var(--gold-a6)]",
  brown: "outline-brown-9 shadow-[0_14px_32px_-14px_var(--brown-a6)]",
  mauve: "outline-mauve-9 shadow-[0_14px_32px_-14px_var(--mauve-a6)]",
};

const COLOR_BACKGROUNDS = {
  tomato: "bg-tomato-2",
  red: "bg-red-2",
  crimson: "bg-crimson-2",
  pink: "bg-pink-2",
  plum: "bg-plum-2",
  violet: "bg-violet-2",
  indigo: "bg-indigo-2",
  blue: "bg-blue-2",
  sky: "bg-sky-2",
  cyan: "bg-cyan-2",
  teal: "bg-teal-2",
  jade: "bg-jade-2",
  green: "bg-green-2",
  lime: "bg-lime-2",
  yellow: "bg-yellow-2",
  amber: "bg-amber-2",
  orange: "bg-orange-2",
  gold: "bg-gold-2",
  brown: "bg-brown-2",
  mauve: "bg-mauve-2",
};

const Chip = ({ className, icon: Icon, children, ...rest }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em]",
      className || "bg-mauve-a3 text-mauve-11",
    )}
    {...rest}
  >
    {Icon && <Icon size={9} strokeWidth={3} />}
    {children}
  </span>
);

/**
 * The dashed anchor a satellite column hangs from. Never user-connectable.
 *
 * `showAtZero` keeps the count chip on a column with nothing in it, dimmed:
 * "no fields" and "fields not built" must not look the same.
 */
const SubHandle = ({ id, left, tone, count, label, showAtZero = false }) => (
  <>
    <Handle
      type="source"
      id={id}
      position={Position.Bottom}
      isConnectable={false}
      className="!h-2 !w-2 !min-w-0 !border-0 !bg-mauve-8"
      style={{ left, opacity: count > 0 ? 1 : 0 }}
    />
    {(count > 0 || showAtZero) && (
      <span
        className={cn(
          "pointer-events-none absolute top-full mt-2 -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] tabular-nums",
          count > 0 ? tone : "bg-mauve-a3 text-mauve-11 opacity-60",
        )}
        style={{ left }}
      >
        {label} · {count}
      </span>
    )}
  </>
);


/**
 * How a Stage answers "who can see this?" while the "View as" lens is on:
 * the verdict for that one identity, and why.
 */
const LENS_COPY = {
  hidden: {
    icon: EyeOff,
    tone: "text-mauve-11",
    text: (who) => `No access for ${who}`,
    title: (who) =>
      `${who} has no access to this Stage — shut out here, or not named on this flow. They may still hold a Deal Team role on an individual SOR.`,
  },
  "calls-in": {
    icon: Eye,
    tone: "text-amber-11",
    text: (who) => `Calls ${who} in`,
    title: (who) => `This Stage calls ${who} in, which is what opens their access window.`,
  },
  "deal-team": {
    icon: Eye,
    tone: "text-mauve-11",
    text: () => "Deal Team",
    title: (who) => `${who} is on the Deal Team: full access to this Stage.`,
  },
  "can-edit": {
    icon: Eye,
    tone: "text-mauve-11",
    text: () => "Can view and edit",
    title: (who) => `${who} is in Always edits: can see and edit SORs on this Stage.`,
  },
  "view-only": {
    icon: Eye,
    tone: "text-mauve-11",
    text: () => "Can view, can't edit",
    title: (who) =>
      `${who} is in Always sees: can read and move SORs on this Stage, but not edit them.`,
  },
};
// Lens off never reaches this copy; an unknown state reads as the safest one.
const LENS_FALLBACK = LENS_COPY.hidden;

const LensLine = ({ state, viewAsLabel }) => {
  const copy = LENS_COPY[state] || LENS_FALLBACK;
  const Icon = copy.icon;
  return (
    <>
      <Icon size={12} strokeWidth={2.5} className={cn("shrink-0", copy.tone)} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[10.5px] font-bold leading-none",
          copy.tone,
        )}
      >
        {copy.text(viewAsLabel)}
      </span>
    </>
  );
};

/** Faces before the count takes over. Four fit the node; the number carries the rest. */
const FACE_LIMIT = 4;

/**
 * What a Stage says about its own audience — always, on the canvas.
 *
 * The chip this replaces said the word "Access" and nothing more, so a Stage
 * calling eleven people in looked identical to one calling nobody, and a
 * Stage that restricted its own Deal Team looked identical to both. This
 * names them instead: the faces of who is called in here, how many, and
 * whether anyone is shut out. It never hides, because "Deal Team only" is an
 * answer and an empty node is not.
 *
 * Clicking it opens the Stage's Access tab, which is the only place the
 * roster can actually be changed.
 */
const AudienceStrip = ({ audience, lensState, viewAsLabel, stageName, onOpen }) => {
  const calledIn = audience?.calledIn ?? [];
  const faces = calledIn.slice(0, FACE_LIMIT);
  const shutOutCount =
    (audience?.counts?.shutOutRoles ?? 0) + (audience?.shutOutGroups?.length ?? 0);

  const roster = calledIn.map((person) => person.name).join(", ");
  const everyone = Boolean(audience?.everyoneSees);
  const title = viewAsLabel
    ? (LENS_COPY[lensState] || LENS_FALLBACK).title(viewAsLabel)
    : everyone
      ? "Everyone sees this Stage (Always sees includes Everyone)."
      : calledIn.length > 0
      ? `Called in here: ${roster}`
      : "Nobody is called in here. Only the Deal Team sees this Stage.";

  return (
    // Full-bleed footer: the hover tint fills the whole bottom of the node,
    // not just the button, so it reads as one region.
    <div
      // The button inside is the keyboard target; its click bubbles here, so
      // one handler covers the whole footer.
      onClick={(event) => {
        event.stopPropagation();
        onOpen?.();
      }}
      className="nodrag nopan -mx-4 -mb-3.5 mt-0.5 cursor-pointer rounded-b-2xl border-t border-mauve-a4 px-4 pt-2 pb-3 transition-colors hover:bg-mauve-a3"
    >
      <Button
        type="button"
        variant="ghost"
        title={title}
        aria-label={stageName ? `${stageName}: ${title}` : title}
        className={cn(
          "nodrag nopan -my-0.5 h-auto w-full justify-start gap-2 rounded-lg px-1 py-1 text-left hover:bg-transparent",
        )}
      >
        {viewAsLabel ? (
          <LensLine state={lensState} viewAsLabel={viewAsLabel} />
        ) : (
          <>
            {everyone ? (
              <Globe size={12} className="shrink-0 text-muted-foreground" />
            ) : faces.length > 0 ? (
              <span className="flex shrink-0 items-center">
                {faces.map((person, index) => (
                  <span
                    key={person.employeeId}
                    className="flex size-[18px] items-center justify-center rounded-full bg-mauve-a3 text-[8px] font-black text-mauve-11 ring-1 ring-mauve-2"
                    style={{ marginLeft: index === 0 ? 0 : -5 }}
                  >
                    {initialsOf(person.name)}
                  </span>
                ))}
              </span>
            ) : (
              <Users size={12} className="shrink-0 text-muted-foreground" />
            )}

            <span className="min-w-0 flex-1 truncate text-[10.5px] leading-none">
              {everyone ? (
                <span className="font-semibold text-muted-foreground">Everyone</span>
              ) : calledIn.length > 0 ? (
                <>
                  <span className="font-black tabular-nums text-foreground">
                    {calledIn.length}
                  </span>
                  <span className="font-semibold text-muted-foreground"> called in</span>
                </>
              ) : (
                <span className="font-semibold text-muted-foreground">Deal Team only</span>
              )}
            </span>

            {shutOutCount > 0 && (
              <span className="flex shrink-0 items-center gap-0.5 text-[10.5px] font-black leading-none tabular-nums text-amber-11">
                <ShieldOff size={10} strokeWidth={2.75} />
                {shutOutCount}
              </span>
            )}
          </>
        )}
      </Button>
    </div>
  );
};

function FlowCanvasNode({ data, isConnectable, selected }) {
  const {
    stage,
    isEntry,
    isWon,
    disabled,
    conditionCount = 0,
    actionCount = 0,
    fieldCount = 0,
    hasOutgoing = false,
    canAddStage = false,
    onAddStage,
    hasAccessFallbackWarning = false,
    audience = null,
    accessLensState = null,
    viewAsLabel = null,
    onOpenAccess,
  } = data;
  const [addOpen, setAddOpen] = useState(false);
  const role = roleOf({ isEntry, isWon, isTerminal: stage.is_terminal });
  const RoleIcon = role.icon;
  const colorKey = stage.color || "mauve";
  const tile = COLOR_TILES[colorKey] || role.tile;

  // Always there when there's nowhere else to leave from; otherwise it's a
  // hover affordance so a fully-wired flow doesn't read as a wall of plusses.
  // Never on a Stage meant to end the flow, and never once the flow is
  // published — Edit draft is the only way back to editing it (issue #195).
  const showPlus = canAddStage && !stage.is_terminal;
  const plusAlwaysVisible = !hasOutgoing;

  const outlineClass = selected
    ? `outline-2 ${COLOR_OUTLINES_SELECTED[colorKey] || COLOR_OUTLINES_SELECTED.mauve}`
    : `outline-1 ${COLOR_OUTLINES[colorKey] || COLOR_OUTLINES.mauve}`;

  const bgClass = COLOR_BACKGROUNDS[colorKey] || COLOR_BACKGROUNDS.mauve;

  // Issue #296 — "View as" dims a Stage the selected identity can't see at
  // all, and rings one that calls them in; `null` (nobody selected, or
  // nothing restricts/calls this Stage) leaves the node exactly as it was.
  const isHiddenForViewer = accessLensState === "hidden";
  const callsViewerIn = accessLensState === "calls-in";

  return (
    <div
      style={{ width: STAGE_W, minHeight: STAGE_H }}
      className={cn(
        "group/stage relative flex flex-col justify-center gap-2 rounded-2xl px-4 py-3.5",
        bgClass,
        "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_10px_24px_-14px_rgba(0,0,0,0.35)]",
        "transition-[box-shadow,outline-color,opacity] duration-150",
        "-outline-offset-1",
        outlineClass,
        isHiddenForViewer && "opacity-50 grayscale",
        callsViewerIn && "outline-2 outline-amber-9 shadow-[0_0_0_4px_var(--amber-a4)]",
      )}
    >
      <Handle
        id={HANDLE_IN}
        type="target"
        position={Position.Left}
        isConnectable={!disabled && isConnectable}
        className="!h-3 !w-3 !border-2 !border-card !bg-mauve-9 !-left-1.5"
      />
      <Handle
        id={HANDLE_OUT}
        type="source"
        position={Position.Right}
        isConnectable={!disabled && isConnectable}
        className={cn(
          "!h-3 !w-3 !border-2 !border-card !bg-primary !-right-1.5",
          disabled && "!bg-mauve-8",
        )}
      />

      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            tile,
          )}
        >
          <RoleIcon size={17} strokeWidth={2.5} />
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[15px] font-bold leading-tight tracking-[-0.01em] text-foreground"
            title={stage.name}
          >
            {stage.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {isEntry && <Chip className={ROLE.entry.chip} icon={CircleDot}>Entry</Chip>}
            {isWon && <Chip className={ROLE.won.chip} icon={Flag}>Won</Chip>}
            {stage.is_terminal && (
              <Chip className={ROLE.terminal.chip} icon={Octagon}>Terminal</Chip>
            )}
            {endsAsWon(stage) && <Chip className={ROLE.won.chip} icon={Flag}>Ends won</Chip>}
            {!isEntry && !isWon && !stage.is_terminal && (
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Stage
              </span>
            )}
            {hasAccessFallbackWarning && (
              <Chip
                className="bg-amber-a4 text-amber-11"
                icon={AlertTriangle}
                title="An access window here fell back to 'calling Stage left' — its chosen end Stage was deleted."
              >
                Access fallback
              </Chip>
            )}
          </div>
        </div>
      </div>

      <AudienceStrip
        audience={audience}
        lensState={accessLensState}
        viewAsLabel={viewAsLabel}
        stageName={stage.name}
        onOpen={onOpenAccess}
      />

      <SubHandle
        id="gate"
        left="24%"
        count={conditionCount}
        label="Gate"
        tone="bg-amber-a3 text-amber-11"
      />
      <SubHandle
        id="fields"
        left="50%"
        count={fieldCount}
        label="Fields"
        tone="bg-blue-a3 text-blue-11"
        showAtZero
      />
      <SubHandle
        id="run"
        left="76%"
        count={actionCount}
        label="On entry"
        tone="bg-violet-a3 text-violet-11"
      />

      {showPlus && (
        <div
          className={cn(
            "nodrag absolute -right-16 top-1/2 z-10 -translate-y-1/2 transition-opacity duration-150",
            plusAlwaysVisible || addOpen
              ? "opacity-100"
              : "opacity-0 group-hover/stage:opacity-100 focus-within:opacity-100",
          )}
        >
          <Dropdown
            isOpen={addOpen}
            onToggle={() => setAddOpen((prev) => !prev)}
            onClose={() => setAddOpen(false)}
            usePortal
            placement="bottom-start"
            popoverClassName="popover-enter z-[10001] w-72 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6"
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Add Stage after ${stage.name}`}
                className="size-8 rounded-full border-2 border-card bg-mauve-9 text-white shadow-sm hover:scale-110 hover:bg-mauve-10"
              >
                <Plus size={16} strokeWidth={2.5} />
              </Button>
            }
          >
            {({ close }) => <AddStagePopoverForm onSubmit={onAddStage} close={close} />}
          </Dropdown>
        </div>
      )}

      {/* Screen-reader summary: the two chips above read as counts out of context. */}
      <span className="sr-only">
        {conditionCount} condition{conditionCount === 1 ? "" : "s"} to leave,{" "}
        {fieldCount} field{fieldCount === 1 ? "" : "s"} to fill in,{" "}
        {actionCount} action{actionCount === 1 ? "" : "s"} on entry.
      </span>
    </div>
  );
}

export default memo(FlowCanvasNode);
