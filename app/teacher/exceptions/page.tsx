import { DateTime } from "luxon";
import { Trash2, CalendarOff, Repeat, PencilLine, Ban } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { listScheduleExceptions } from "@/lib/timetable";
import { schoolToday } from "@/lib/time";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";
import { ClassroomChipTabs } from "@/components/classroom-chip-tabs";
import { ListGroup, ListRow } from "@/components/ios-list";
import { RowIcon } from "@/components/row-icon";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ExceptionForm } from "./exception-form";
import { deleteExceptionAction } from "./actions";

const KIND_LABEL: Record<string, string> = {
  HOLIDAY: "วันหยุด",
  PERIOD_SWAP: "สลับคาบ",
  EXAM: "วันสอบ",
  CANCELLED_PERIOD: "งดคาบเรียน",
};

const KIND_TONE = {
  HOLIDAY: "success",
  PERIOD_SWAP: "info",
  EXAM: "warning",
  CANCELLED_PERIOD: "neutral",
} as const;

const KIND_ICON = {
  HOLIDAY: CalendarOff,
  PERIOD_SWAP: Repeat,
  EXAM: PencilLine,
  CANCELLED_PERIOD: Ban,
} as const;

export default async function TeacherExceptionsPage({
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

  const today = schoolToday();
  const to = DateTime.fromISO(today).plus({ months: 3 }).toISODate()!;

  const [exceptions, subjects] = await Promise.all([
    listScheduleExceptions(actor, classroom.id, { from: today, to }),
    // Scoped to this classroom's school; archived subjects excluded — an
    // exception shouldn't be able to swap in a subject that's been retired.
    prisma.subject.findMany({
      where: { schoolId: classroom.schoolId, archivedAt: null, teachingAssignments: { some: { classroomId: classroom.id } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <PageHeader title="วันหยุด / สลับคาบ / วันสอบ" />

      <ClassroomChipTabs
        classrooms={classrooms}
        activeId={classroom.id}
        hrefFor={(id) => `/teacher/exceptions?classroomId=${id}`}
      />

      <Card className="rounded-3xl">
        <CardHeader>
          <CardTitle className="text-base">เพิ่มรายการ</CardTitle>
        </CardHeader>
        <CardContent>
          <ExceptionForm schoolId={classroom.schoolId} classroomId={classroom.id} subjects={subjects} />
        </CardContent>
      </Card>

      <ListGroup label="รายการที่จะถึง">
        {exceptions.length === 0 ? (
          <ListRow chevron={false}>
            <span className="text-sm text-muted-foreground">ไม่มีรายการในช่วงนี้</span>
          </ListRow>
        ) : (
          exceptions.map((e) => (
            <ListRow
              key={e.id}
              chevron={false}
              leading={<RowIcon icon={KIND_ICON[e.kind as keyof typeof KIND_ICON]} tone={KIND_TONE[e.kind as keyof typeof KIND_TONE]} />}
              trailing={
                <form action={deleteExceptionAction}>
                  <input type="hidden" name="exceptionId" value={e.id} />
                  <input type="hidden" name="classroomId" value={classroom.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label="ลบรายการนี้"
                    confirmMessage="ลบรายการนี้ใช่ไหม"
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </ConfirmSubmitButton>
                </form>
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {DateTime.fromJSDate(e.date, { zone: "utc" }).toFormat("d LLL yyyy")}
                </span>
                <StatusBadge tone={KIND_TONE[e.kind as keyof typeof KIND_TONE]}>{KIND_LABEL[e.kind]}</StatusBadge>
                {e.period && <span className="text-muted-foreground">คาบ {e.period}</span>}
                {e.note && <span className="text-muted-foreground">{e.note}</span>}
              </div>
            </ListRow>
          ))
        )}
      </ListGroup>
    </div>
  );
}
