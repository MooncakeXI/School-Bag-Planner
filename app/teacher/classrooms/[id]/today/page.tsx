import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { getPackingStatus } from "@/lib/packing";
import { schoolToday, schoolDateToUtcMidnight } from "@/lib/time";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { spotCheckAction } from "./actions";

export default async function ClassroomTodayPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id: classroomId } = await params;

  const allowed = await can(actor, "edit_roster", { type: "classroom", classroomId });
  if (!allowed) notFound();

  const classroom = await prisma.classroom.findUniqueOrThrow({ where: { id: classroomId }, select: { name: true } });

  const today = schoolDateToUtcMidnight(schoolToday());
  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classroomId, OR: [{ endDate: null }, { endDate: { gte: today } }] } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const statuses = await Promise.all(
    students.map(async (s) => ({ student: s, status: await getPackingStatus(s.id, schoolToday()) })),
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">ใครจัดกระเป๋าแล้ว · {classroom.name}</h1>
        <p className="text-sm text-muted-foreground">
          ตรวจของที่นักเรียนสแกนไว้เมื่อคืน — ถ้าของไม่อยู่ในกระเป๋าจริง กดแจ้งเพื่อหักคะแนนและตัดสตรีค
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {statuses.map(({ student, status }) => {
          const tone = status.isComplete ? "success" : status.packedCount > 0 ? "warning" : "neutral";
          const label = status.isComplete ? "ครบ" : status.packedCount > 0 ? "ยังไม่ครบ" : "ยังไม่เปิดแอป";
          const checkedItems = status.items.filter((i) => i.checked);

          return (
            <div key={student.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-4">
                <p className="font-semibold">{student.name}</p>
                <StatusBadge tone={tone}>{label}</StatusBadge>
              </div>
              {checkedItems.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {checkedItems.map((item) => (
                    <div key={item.itemCopyId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{item.subjectItemName}</span>
                      <form action={spotCheckAction}>
                        <input type="hidden" name="classroomId" value={classroomId} />
                        <input type="hidden" name="itemCopyId" value={item.itemCopyId} />
                        <Button type="submit" variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive">
                          ของไม่อยู่จริง
                        </Button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
