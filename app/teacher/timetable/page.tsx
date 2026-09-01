import Link from "next/link";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { listTimetableSlots } from "@/lib/timetable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { updateTimetableSlotAction } from "./actions";
import { SubjectSelect } from "./subject-select";

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
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  if (classrooms.length === 0) {
    return <p className="text-sm text-muted-foreground">ยังไม่มีห้องเรียนที่คุณสอน</p>;
  }

  const classroomId = requestedId && classrooms.some((c) => c.id === requestedId) ? requestedId : classrooms[0].id;

  const [slots, subjects] = await Promise.all([
    listTimetableSlots(actor, classroomId),
    prisma.subject.findMany({ orderBy: { name: "asc" } }),
  ]);

  const slotBySpot = new Map(slots.map((s) => [`${s.weekday}-${s.period}`, s]));

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-xl font-semibold">ตารางเรียน</h1>

      <div className="flex flex-wrap gap-1">
        {classrooms.map((c) => (
          <Link
            key={c.id}
            href={`/teacher/timetable?classroomId=${c.id}`}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              c.id === classroomId ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20" />
              {WEEKDAYS.map((w) => (
                <TableHead key={w.value} className="text-center">
                  {w.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERIODS.map((period) => (
              <TableRow key={period}>
                <TableCell className="font-medium text-muted-foreground">คาบ {period}</TableCell>
                {WEEKDAYS.map((w) => {
                  const slot = slotBySpot.get(`${w.value}-${period}`);
                  return (
                    <TableCell key={w.value} className="min-w-32 p-1.5">
                      <form action={updateTimetableSlotAction}>
                        <input type="hidden" name="classroomId" value={classroomId} />
                        <input type="hidden" name="weekday" value={w.value} />
                        <input type="hidden" name="period" value={period} />
                        <SubjectSelect defaultValue={slot?.subjectId ?? ""} subjects={subjects} />
                      </form>
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
