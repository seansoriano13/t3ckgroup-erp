/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype (see PrototypeSwitcher).
 * Picks the layout to render inside SorModal's own Dialog. SorModal keeps
 * every query, mutation and handler; only the rendered subtree changes.
 * Files are named for the layout, not its letter: the switcher's letters get
 * reshuffled as layouts are dropped, and the letter lives only here and in
 * PrototypeSwitcher's VARIANTS.
 */
import OverviewBoardLayout from "./LayoutOverviewBoard";
import FlowRailLayout from "./LayoutFlowRail";
import RailSummaryLayout from "./LayoutRailSummary";
import RailBoardLayout from "./LayoutRailBoard";
import ThreadLayout from "./LayoutThread";
import SummaryStackedLayout from "./LayoutSummaryStacked";
import SummaryTwoColumnLayout from "./LayoutSummaryTwoColumn";
import SummaryReportLayout from "./LayoutSummaryReport";

const BY_KEY = {
  B: OverviewBoardLayout,
  C: FlowRailLayout,
  D: RailSummaryLayout,
  E: RailBoardLayout,
  F: ThreadLayout,
  G: SummaryStackedLayout,
  H: SummaryTwoColumnLayout,
  I: SummaryReportLayout,
};

export default function SorModalPrototype({ variant, p }) {
  const Layout = BY_KEY[variant];
  return Layout ? <Layout p={p} /> : null;
}
