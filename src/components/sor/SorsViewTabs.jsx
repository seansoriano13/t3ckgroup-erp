import { List, Kanban, LayoutDashboard, Trash2 } from "lucide-react";
import TabGroup from "../ui/TabGroup";

/**
 * The SORS title and its view strip: List, Board, Overview, Deleted. Retail
 * left this strip for its own screen at /retail — the strip was the crowded
 * thing, and a retail order is not something you scan the register for.
 *
 * Shared by the register and the Release Notes deck.
 */
export default function SorsViewTabs({ view, onChange }) {
  return (
    <>
      <h1 className="shrink-0 text-sm font-black uppercase tracking-widest text-foreground">
        SORS
      </h1>

      <TabGroup
        tabs={[
          { value: "list", label: "List", icon: List },
          { value: "board", label: "Board", icon: Kanban },
          { value: "overview", label: "Overview", icon: LayoutDashboard },
          { value: "deleted", icon: Trash2, label: "Deleted" },
        ]}
        activeTab={view}
        onChange={onChange}
        variant="pill"
        size="sm"
        className="shrink-0"
      />
    </>
  );
}
