"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createItemCopiesForClassroomAction } from "@/app/teacher/classrooms/[id]/actions";

type SubjectItemOption = { id: string; name: string };

/** Bulk-creates an ItemCopy for every student in the classroom for the
 * selected subject items in one action (~40 students x 8 items otherwise
 * typed one at a time). `items` is already scoped to what this actor may
 * manage in this classroom (see page.tsx's subjectItemsHere). */
export function BulkAddItemsButton({ classroomId, items }: { classroomId: string; items: SubjectItemOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      try {
        const r = await createItemCopiesForClassroomAction(classroomId, Array.from(selected));
        setResult(r);
        setSelected(new Set());
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
      }
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="h-8 rounded-xl" onClick={() => setOpen(true)}>
        <PackagePlus className="size-3.5" />
        เพิ่มเล่มทั้งห้อง
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">เลือกรายการที่จะเพิ่มให้นักเรียนทุกคนในห้องนี้</p>
      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <label key={item.id} className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
            />
            {item.name}
          </label>
        ))}
      </div>
      {result && (
        <p className="text-xs text-success">
          เพิ่มแล้ว {result.created} รายการ (ข้าม {result.skipped} รายการที่มีอยู่แล้ว)
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" className="h-8 rounded-xl" onClick={submit} disabled={pending || selected.size === 0}>
          เพิ่มเข้าทั้งห้อง
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-8 rounded-xl" onClick={() => setOpen(false)}>
          ปิด
        </Button>
      </div>
    </div>
  );
}
