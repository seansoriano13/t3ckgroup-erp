import { List, Kanban, LayoutDashboard, Trash2 } from "lucide-react";
import TabGroup from "../ui/TabGroup";

/**
 * The register's view strip: List, Board, Overview, Deleted. Retail left this
 * strip for its own screen at /retail — the strip was the crowded thing, and a
 * retail order is not something you scan the register for.
 *
 * No "SORS" title rides along any more: the strip opens the register's header
 * row on its own, and the SideNav's active item already says where you are.
 * The Release Notes deck still draws that title itself, on the one slide whose
 * whole subject is the rename.
 *
 * Shared by the register and the Release Notes deck.
 */
export default function SorsViewTabs({ view, onChange }) {
  return (
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
      // Labels go below sm — four of them is more than a phone-width toolbar
      // can spare, and each tab keeps its name through TabGroup's aria-label.
      labelClassName="hidden sm:inline"
      // Below md the strip is what gives when the row runs out of width: it
      // already scrolls horizontally, so it degrades by scrolling rather than
      // by shoving Filters off the edge.
      className="min-w-0 shrink md:shrink-0"
    />
  );
}
