"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui";
import { Button } from "@/components/ui";

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4">
      <ErrorState description="An unexpected error occurred while loading this page." />
      <Button onClick={reset} variant="secondary">
        Try again
      </Button>
    </div>
  );
}
