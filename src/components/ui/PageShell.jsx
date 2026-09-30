import PageContainer from "./PageContainer";
import PageHeader from "./PageHeader";

/**
 * The Page skeleton (ADR 0029, DESIGN.md "Pages → PageShell").
 *
 * Slots render in one fixed order — header (title, description, `action`),
 * `tabs` (level 1), `toolbar` (level 2 pills, filter bar, display toggle),
 * body — whatever order a Page passes them in. A Page cannot reorder them.
 *
 * `frame` is "centred" (default, the wrapper) or "full"; full-width stays an
 * explicit per-route choice. A full frame fills the app frame: the header,
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
  action,
  tabs,
  toolbar,
  body,
  children,
  frame = "centred",
  className = "",
}) {
  const full = frame === "full";
  const pinned = full ? "shrink-0" : "";

  return (
    <PageContainer
      maxWidth={full ? "full" : "7xl"}
      fill={full}
      spaceY="4"
      className={className}
    >
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
