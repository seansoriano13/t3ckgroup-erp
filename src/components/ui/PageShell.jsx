import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";

/**
 * The Page skeleton (ADR 0029, DESIGN.md "Pages → PageShell").
 *
 * Slots render in one fixed order — `banner` (only the Dashboard's greeting),
 * header (title, description, `action`),
 * `tabs` (level 1), `toolbar` (level 2 pills, filter bar, display toggle),
 * body — whatever order a Page passes them in. A Page cannot reorder them.
 *
 * `frame` is "centred" (default, the wrapper), "narrow" (the Config type: a
 * narrow centred column for settings rows and forms) or "full"; full-width
 * stays an explicit per-route choice. A full frame fills the app frame: the header,
 * tabs and toolbar stay put and the body is the scroll region (a Board inside
 * it sizes itself to the body and scrolls its own columns). The body is
 * `children` (or `body`).
 *
 * Phone behaviour lives here: the header stacks, the tabs strip scrolls
 * sideways (TabGroup), the toolbar wraps.
 */
export default function PageShell({
  title,
  description,
  banner,
  action,
  tabs,
  toolbar,
  body,
  children,
  frame = "centred",
  className = "",
}) {
  const full = frame === "full";
  const maxWidth = full ? "full" : frame === "narrow" ? "4xl" : "7xl";
  const pinned = full ? "shrink-0" : "";

  return (
    <PageContainer
      maxWidth={maxWidth}
      fill={full}
      spaceY="4"
      className={className}
    >
      {banner && <div className={pinned}>{banner}</div>}
      <PageHeader title={title} description={description}>
        {action}
      </PageHeader>
      {tabs && (
        <div data-testid="page-tabs" className={`max-w-full overflow-x-auto ${pinned}`}>
          {tabs}
        </div>
      )}
      {toolbar && (
        <div
          data-testid="page-toolbar"
          className={`flex flex-wrap items-center gap-3 ${pinned}`}
        >
          {toolbar}
        </div>
      )}
      <div
        data-testid="page-body"
        className={full ? "custom-scrollbar min-h-0 flex-1 overflow-y-auto" : undefined}
      >
        {body ?? children}
      </div>
    </PageContainer>
  );
}
