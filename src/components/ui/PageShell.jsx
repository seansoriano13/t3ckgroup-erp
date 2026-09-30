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
 * explicit per-route choice. The body is `children` (or `body`).
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
  return (
    <PageContainer
      maxWidth={frame === "full" ? "full" : "7xl"}
      spaceY="4"
      className={className}
    >
      <PageHeader title={title} description={description}>
        {action}
      </PageHeader>
      {tabs && <div data-testid="page-tabs" className="max-w-full overflow-x-auto">{tabs}</div>}
      {toolbar && (
        <div data-testid="page-toolbar" className="flex flex-wrap items-center gap-3">
          {toolbar}
        </div>
      )}
      <div data-testid="page-body">{body ?? children}</div>
    </PageContainer>
  );
}
