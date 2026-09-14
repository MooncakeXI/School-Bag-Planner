import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere, manageableSubjectsInClassroom } from "@/lib/policy";
import { listTimetableSlots } from "@/lib/timetable";
import { termFor } from "@/lib/terms";
import { schoolToday } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/page-header";
import { ClassroomChipTabs } from "@/components/classroom-chip-tabs";
import { SubjectChip } from "@/components/subject-chip";

const WEEKDAYS = [
  { value: "MON", label: "จันทร์" },
  { value: "TUE", label: "อังคาร" },
  { value: "WED", label: "พุธ" },
  { value: "THU", label: "พฤหัสบดี" },
  { value: "FRI", label: "ศุกร์" },
] as const;

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

export default async function TeacherTimetablePage({
  searchParams,
}: {
  searchParams: Promise<{ classroomId?: string }>;
}) {
  const actor = await requireActor();
  const { classroomId: requestedId } = await searchParams;

  const classrooms = await prisma.classroom.findMany({
    where: visibleClassroomWhere(actor),
    select: { id: true, name: true, schoolId: true },
    orderBy: { name: "asc" },
  });

  if (classrooms.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่มีห้องเรียนที่คุณสอน</p>;
  }

  const classroom = classrooms.find((c) => c.id === requestedId) ?? classrooms[0];
  const classroomId = classroom.id;

  const [slots, manageableSubjects, currentTerm] = await Promise.all([
    listTimetableSlots(actor, classroomId),
    // The subjects this actor is actually responsible for in this
    // classroom (homeroom → every subject taught here; a subject teacher →
    // only their own TeachingAssignment rows) — used purely to highlight
    // "your periods" below, the same scoping edit_item_copy already uses
    // everywhere else, not a new authorization shape.
    manageableSubjectsInClassroom(actor, classroomId),
    // Shown so it's never ambiguous which term is displayed — this page
    // always shows "the term covering today" (lib/timetable.ts's
    // resolveTermId), there is no term picker yet.
    termFor(classroom.schoolId, schoolToday()),
  ]);

  const myOwnSubjectIds = new Set(manageableSubjects.map((s) => s.id));
  const slotBySpot = new Map(slots.map((s) => [`${s.weekday}-${s.period}`, s]));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ตารางเรียน" subtitle={currentTerm ? currentTerm.name : undefined} />

      {!currentTerm && (
        <p className="text-sm text-muted-foreground">
          ยังไม่มีภาคเรียนที่ครอบคลุมวันนี้สำหรับโรงเรียนนี้
        </p>
      )}

      <ClassroomChipTabs
        classrooms={classrooms}
        activeId={classroomId}
        hrefFor={(id) => `/teacher/timetable?classroomId=${id}`}
      />

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-primary" />
          วิชาที่คุณสอน
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-muted-foreground/30" />
          วิชาอื่น
        </span>
      </div>

      <p className="-mt-3 text-sm text-muted-foreground lg:hidden">เลื่อนซ้าย–ขวาเพื่อดูคาบอื่น</p>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="sticky left-0 z-10 min-w-24 bg-card px-4 font-heading text-sm">วัน / คาบ</TableHead>
              {PERIODS.map((period) => (
                <TableHead key={period} className="min-w-24 px-4 text-center font-heading text-sm">
                  คาบ {period}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {WEEKDAYS.map((w) => (
              <TableRow key={w.value}>
                <TableCell className="sticky left-0 z-10 bg-card px-4 font-heading font-semibold">{w.label}</TableCell>
                {PERIODS.map((period) => {
                  const slot = slotBySpot.get(`${w.value}-${period}`);
                  const isMine = slot ? myOwnSubjectIds.has(slot.subjectId) : false;
                  return (
                    <TableCell key={period} className="min-w-24 p-2">
                      {slot ? (
                        <div
                          className={cn(
                            "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-lg p-2.5 text-center",
                            isMine ? "bg-primary/10 ring-2 ring-primary/60" : "bg-muted/60",
                          )}
                        >
                          <SubjectChip subjectName={slot.subject.name} className="size-8" showIcon />
                          <span className={cn("w-full whitespace-normal px-1 text-xs leading-snug", isMine ? "font-semibold text-primary" : "text-muted-foreground")}>
                            {slot.subject.name}
                          </span>
                        </div>
                      ) : (
                        <div className="flex min-h-14 items-center justify-center text-muted-foreground/40">—</div>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
