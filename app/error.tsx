"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// App-wide error boundary (Next.js convention: this file catches every
// unhandled throw below the root layout — a Server Component render error,
// or a Server Action that throws, e.g. a ForbiddenError from lib/policy.ts's
// can() checks). Without this, any such error crashes to Next's raw error
// screen. Shown as a modal overlay rather than replacing the whole page, so
// the app underneath doesn't visually disappear.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="error-title"
        className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-card p-8 text-center ring-1 ring-border"
      >
        <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <TriangleAlert className="size-7" />
        </div>
        <div className="space-y-1.5">
          <h1 id="error-title" className="font-heading text-xl font-semibold">
            เกิดข้อผิดพลาด
          </h1>
          <p className="text-sm text-muted-foreground">ขออภัย มีบางอย่างผิดพลาด กรุณาลองใหม่อีกครั้ง</p>
        </div>
        {process.env.NODE_ENV !== "production" && (
          <p className="w-full overflow-x-auto rounded-lg bg-muted p-2 text-left font-mono text-xs text-muted-foreground">
            {error.message}
          </p>
        )}
        <div className="flex w-full gap-2">
          <Button
            variant="outline"
            className="min-h-11 flex-1 rounded-2xl"
            nativeButton={false}
            render={<Link href="/">กลับหน้าหลัก</Link>}
          />
          <Button className="min-h-11 flex-1 rounded-2xl" onClick={() => reset()}>
            ลองใหม่
          </Button>
        </div>
      </div>
    </div>
  );
}
