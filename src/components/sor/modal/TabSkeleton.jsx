import Spinner from "../../ui/Spinner";

export default function TabSkeleton() {
  return (
    <div className="flex items-center justify-center py-16">
      <Spinner size="md" className="text-primary" />
    </div>
  );
}
