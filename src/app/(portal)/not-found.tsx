import Link from "next/link";
import { EmptyState, Button } from "@/components/ui";

export default function PortalNotFound() {
  return (
    <div className="flex flex-col items-center gap-4">
      <EmptyState
        title="Page not found"
        description="The resource you're looking for doesn't exist or you don't have access to it."
      />
      <Link href="/dashboard">
        <Button variant="secondary">Return to Dashboard</Button>
      </Link>
    </div>
  );
}
