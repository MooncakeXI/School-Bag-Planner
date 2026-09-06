"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Undo2, CheckCircle2, Loader2 } from "lucide-react";
import { QRScanner } from "@/components/qr-scanner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { scanBindAction, scanUndoBindAction } from "@/app/teacher/classrooms/[id]/actions";

export type BindTarget = { itemCopyId: string; label: string; bound: boolean };

/**
 * Shared modal for both "scan to bind" (a single ItemCopy) and "rapid bind"
 * (a whole student's items, one after another) — the single-item case is
 * just this component given a one-item `targets` list, so there is no
 * separate implementation to keep in sync. Every scan goes through
 * scanBindAction -> lib/qr.ts's bindCode, exactly like the manual typed-code
 * form; this component only ever sees the decoded string as a claim and the
 * server's ok/error response, never deciding a bind on its own.
 */
export function BindScannerModal({
  targets: initialTargets,
  onClose,
}: {
  targets: BindTarget[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [targets, setTargets] = useState(initialTargets);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [history, setHistory] = useState<{ itemCopyId: string; code: string; label: string }[]>([]);
  const [changed, setChanged] = useState(false);

  const nextTarget = targets.find((t) => !t.bound);

  async function handleDecode(code: string) {
    if (busy || !nextTarget) return;
    setBusy(true);
    const target = nextTarget;
    const result = await scanBindAction(target.itemCopyId, code);
    if (result.ok) {
      setTargets((prev) => prev.map((t) => (t.itemCopyId === target.itemCopyId ? { ...t, bound: true } : t)));
      setHistory((prev) => [...prev, { itemCopyId: target.itemCopyId, code, label: target.label }]);
      setFeedback({ type: "success", text: `ผูกสำเร็จ: ${target.label}` });
      setChanged(true);
    } else {
      setFeedback({ type: "error", text: result.error });
    }
    setBusy(false);
  }

  async function handleUndo() {
    const last = history[history.length - 1];
    if (!last || busy) return;
    setBusy(true);
    const result = await scanUndoBindAction(last.code);
    if (result.ok) {
      setTargets((prev) => prev.map((t) => (t.itemCopyId === last.itemCopyId ? { ...t, bound: false } : t)));
      setHistory((prev) => prev.slice(0, -1));
      setFeedback({ type: "success", text: `ยกเลิกการผูก: ${last.label}` });
    } else {
      setFeedback({ type: "error", text: result.error });
    }
    setBusy(false);
  }

  function handleClose() {
    if (changed) router.refresh();
    onClose();
  }

  const boundCount = targets.filter((t) => t.bound).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-[#141110]">
        <div className="flex items-center justify-between px-4 pt-4">
          <p className="text-sm font-semibold text-white">สแกนเพื่อผูกรหัส QR</p>
          <button
            type="button"
            onClick={handleClose}
            aria-label="ปิด"
            className="-m-2 flex size-11 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>

        {!nextTarget ? (
          <div className="flex flex-col items-center gap-3 p-10 text-center">
            <CheckCircle2 className="size-12 text-[#8FD3B2]" />
            <p className="text-white">ผูกครบทุกเล่มแล้ว</p>
            <Button type="button" onClick={handleClose} className="min-h-11 rounded-xl px-6">
              เสร็จสิ้น
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-3">
              <QRScanner onDecode={(code) => void handleDecode(code)} paused={busy}>
                <p className="pointer-events-none absolute inset-x-0 top-4 text-center text-sm text-white/75">
                  กำลังผูก: {nextTarget.label}
                </p>
                {busy && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                    <Loader2 className="size-8 animate-spin text-white" />
                  </div>
                )}
              </QRScanner>
            </div>

            {feedback && (
              <div
                className={cn(
                  "mx-4 mt-3 rounded-2xl p-3 text-center text-sm",
                  feedback.type === "success" ? "bg-[#2E7D5B]/25 text-[#8FD3B2]" : "bg-accent text-accent-foreground",
                )}
              >
                {feedback.text}
              </div>
            )}

            <div className="flex items-center justify-between px-4 py-3">
              <Button type="button" variant="ghost" size="sm" onClick={handleUndo} disabled={history.length === 0 || busy}>
                <Undo2 className="size-4" />
                เลิกทำล่าสุด
              </Button>
              <span className="text-xs text-white/50">
                ผูกแล้ว {boundCount}/{targets.length}
              </span>
            </div>

            <div className="flex flex-col gap-1.5 overflow-y-auto px-4 pb-4">
              {targets.map((t) => (
                <div
                  key={t.itemCopyId}
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-2 text-sm",
                    t.bound
                      ? "bg-white/5 text-white/40 line-through"
                      : t.itemCopyId === nextTarget.itemCopyId
                        ? "bg-white/15 text-white"
                        : "bg-white/[0.07] text-white/80",
                  )}
                >
                  <span className="truncate">{t.label}</span>
                  {t.bound && <CheckCircle2 className="size-4 shrink-0 text-[#8FD3B2]" />}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
