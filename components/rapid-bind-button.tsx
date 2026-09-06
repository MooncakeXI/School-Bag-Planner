"use client";

import { useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BindScannerModal, type BindTarget } from "@/components/bind-scanner-modal";

/** "Rapid bind" for one student — scans continuously, one sticker after
 * another, each binding to that student's next unbound item in the stable
 * order `targets` is already given in (see the classroom page's
 * itemCopies query, orderBy: createdAt). */
export function RapidBindButton({ targets, disabled }: { targets: BindTarget[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl" onClick={() => setOpen(true)} disabled={disabled}>
        <ScanLine className="size-3.5" />
        สแกนต่อเนื่องทั้งหมด
      </Button>
      {open && <BindScannerModal targets={targets} onClose={() => setOpen(false)} />}
    </>
  );
}
