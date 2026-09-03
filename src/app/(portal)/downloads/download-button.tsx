"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { clientServices } from "@/services/client";

export function DownloadButton({ fileId }: { fileId: string }) {
  const { data: session } = useSession();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function handleClick() {
    if (!session?.user?.tenantId) return;
    setStatus("loading");
    try {
      const url = await clientServices.downloads.getDownloadUrl(session.user.tenantId, fileId);
      window.location.assign(url);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={handleClick} disabled={status === "loading"}>
      <Download className="h-3.5 w-3.5" aria-hidden="true" />
      {status === "loading" ? "Preparing…" : status === "error" ? "Retry" : "Download"}
    </Button>
  );
}
