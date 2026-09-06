"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BindScannerModal } from "@/components/bind-scanner-modal";

/** "Scan to bind" for a single ItemCopy — the manual typed-code field next
 * to this button stays as the fallback for when the camera is unavailable. */
export function ScanBindButton({ itemCopyId, label }: { itemCopyId: string; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(true)}>
        <ScanLine className="size-3.5" />
        สแกน
      </Button>
      {open && (
        <BindScannerModal targets={[{ itemCopyId, label, bound: false }]} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
