import { Suspense, lazy } from "react";
import { Navigate } from "react-router";

import PageShell from "@/components/ui/PageShell";
import PageLoading from "@/components/ui/PageLoading";

// REMOVE-BEFORE-PROD (ADR 0028): the Product status prototype is build-gated.
// The env check sits in the same expression as the import() so Vite folds it
// to `null` and drops the whole prototype folder from a production bundle,
// where this route only redirects. _app.jsx lets /prototypes/* skip login
// under the same check.
const ProductStatusPrototype =
  import.meta.env.VITE_APP_ENV === "staging" || import.meta.env.VITE_APP_ENV === "local"
    ? lazy(() => import("@/components/purchase-request/prototype/ProductStatusPrototype"))
    : null;

export default function ProductStatusPrototypePage() {
  if (!ProductStatusPrototype) return <Navigate to="/" replace />;
  return (
    <PageShell title="Prototype" description="A preview made from the app's real parts and example data. Nothing is saved.">
      <Suspense fallback={<PageLoading label="prototype" />}>
        <ProductStatusPrototype />
      </Suspense>
    </PageShell>
  );
}
