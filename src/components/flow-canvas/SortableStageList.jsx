import { createContext, useContext } from "react";
import { GripVertical } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const HandleContext = createContext(null);

/**
 * Drag-to-reorder for the Stage managers' rows (Fields, Conditions, Actions).
 * Replaces the up/down arrow pair: one grip per row says "draggable" without
 * spending two buttons on it, and a row can travel further than one slot.
 * `onReorder` gets the items in their new order; `disabled` drops the sensors.
 */
export function SortableStageList({ items, onReorder, disabled = false, children }) {
  const sensors = useSensors(
    // A few px of travel before a drag starts, so a click on the grip is not a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  };

  return (
    <DndContext
      sensors={disabled ? [] : sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** The draggable wrapper for one row; `DragGrip` inside it is the handle. */
export function SortableStageRow({ id, className, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  return (
    <HandleContext.Provider value={{ attributes, listeners }}>
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className={cn(className, isDragging && "relative z-10 rounded-xl opacity-90 shadow-lg")}
      >
        {children}
      </div>
    </HandleContext.Provider>
  );
}

export function DragGrip({ label }) {
  const handle = useContext(HandleContext);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      {...handle?.attributes}
      {...handle?.listeners}
      aria-label={label}
      className="shrink-0 cursor-grab touch-none text-muted-foreground/60 hover:bg-transparent hover:text-foreground active:cursor-grabbing"
    >
      <GripVertical size={15} />
    </Button>
  );
}
