import { Link } from "react-router";
import PageShell from "@/components/ui/PageShell";

export default function NotFoundPage() {
  return (
    <PageShell
      title="Page not found"
      description="This address does not match any page."
      frame="narrow"
    >
      <Link to="/" className="font-semibold underline">
        Back to dashboard
      </Link>
    </PageShell>
  );
}
