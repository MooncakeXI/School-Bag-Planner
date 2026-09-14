"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { QRScanner } from "@/components/qr-scanner";
import { SubjectChip } from "@/components/subject-chip";
import { Button } from "@/components/ui/button";
import { recordTeacherScanAction } from "@/app/teacher/classrooms/[id]/pack/[studentId]/actions";

type ScanItem = { itemCopyId: string; subjectItemName: string; subjectName: string; checked: boolean };

// Teacher-run counterpart to components/scan-view.tsx, for students with no
// phone/camera at home in the evening (CLAUDE.md/ARCHITECTURE.md §8.3a) — same
// camera-stays-live decode loop, same "only a real decoded QR code checks an
// item off" rule (CLAUDE.md invariant 7: there is no tap-to-check path here
// either). What differs is whose device this runs on and which server action
// it calls; recordTeacherScanAction targets the student's own session, so
// completion/points/streak all behave exactly like the student's own flow.
export function TeacherScanView({
  classroomId,
  studentId,
  items,
}: {
  classroomId: string;
  studentId: string;
  items: ScanItem[];
}) {
  const router = useRouter();
  const handledCodesRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef(false);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const [lastChecked, setLastChecked] = useState<ScanItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = items.filter((i) => !i.checked);

  const handleDecoded = useCallback(async (code: string, captureFrame: () => string | undefined) => {
    if (handledCodesRef.current.has(code) || inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const photoDataUrl = captureFrame();
      const result = await recordTeacherScanAction({ studentId, code, photoDataUrl });
      if (result.ok) {
        handledCodesRef.current.add(code);
        setError(null);
        const item = itemsRef.current.find((i) => i.itemCopyId === result.itemCopyId);
        if (item) setLastChecked(item);
        router.refresh();
      } else {
        setError(result.error);
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [router, studentId]);

  if (remaining.length === 0) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 rounded-3xl border border-border bg-card p-8 text-center">
        <p className="text-lg font-semibold">จัดกระเป๋าครบแล้ว</p>
        <Button
          nativeButton={false}
          className="min-h-11 rounded-xl"
          render={<Link href={`/teacher/classrooms/${classroomId}`}>กลับไปห้องเรียน</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-[#141110]">
      <QRScanner onDecode={handleDecoded} overlayText="เล็งสติกเกอร์ QR บนปกหนังสือ">
        <div className="absolute inset-x-0 bottom-4 flex justify-center">
          <span className="rounded-full bg-white/15 px-4 py-2 text-sm text-white">
            เหลืออีก {remaining.length} อย่าง
          </span>
        </div>
      </QRScanner>

      {lastChecked && (
        <div className="mx-4 mt-4 flex items-center gap-3.5 rounded-2xl border border-[#8FD3B2]/40 bg-[#2E7D5B]/25 p-3.5">
          <SubjectChip subjectName={lastChecked.subjectName} showIcon />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-semibold text-[#8FD3B2]">สแกนสำเร็จ</p>
            <p className="mt-0.5 truncate text-[15px] font-medium text-white">{lastChecked.subjectItemName}</p>
          </div>
        </div>
      )}
      {error && (
        <div className="mx-4 mt-4 rounded-2xl bg-accent p-3.5 text-center text-sm text-accent-foreground">{error}</div>
      )}

      <div className="flex flex-col gap-2 p-4">
        <p className="px-1 text-[13px] text-white/50">ยังไม่ได้สแกน</p>
        {remaining.map((item) => (
          <div key={item.itemCopyId} className="flex items-center gap-3 rounded-2xl bg-white/[0.07] p-3">
            <SubjectChip subjectName={item.subjectName} className="size-9" showIcon />
            <span className="flex-1 truncate text-[15px] text-white/90">{item.subjectItemName}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
