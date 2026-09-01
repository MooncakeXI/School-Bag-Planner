import Link from "next/link";
import { DateTime } from "luxon";
import { Trash2 } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { listScheduleExceptions } from "@/lib/timetable";
import { schoolToday } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { createExceptionAction, deleteExceptionAction } from "./actions";

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
    prisma.subject.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="font-heading text-xl font-semibold">วันหยุด / สลับคาบ / วันสอบ</h1>

      <div className="flex flex-wrap gap-1">
        {classrooms.map((c) => (
          <Link
            key={c.id}
            href={`/teacher/exceptions?classroomId=${c.id}`}
            className={cn(
              "rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              c.id === classroom.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เพิ่มรายการ</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createExceptionAction} className="flex flex-col gap-4">
            <input type="hidden" name="schoolId" value={classroom.schoolId} />
            <input type="hidden" name="classroomId" value={classroom.id} />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="date">วันที่</Label>
                <Input id="date" type="date" name="date" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kind">ประเภท</Label>
                <select id="kind" name="kind" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="HOLIDAY">วันหยุด (ทั้งวัน)</option>
                  <option value="CANCELLED_PERIOD">งดคาบเรียน</option>
                  <option value="PERIOD_SWAP">สลับคาบ (เปลี่ยนวิชา)</option>
                  <option value="EXAM">วันสอบ</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period">คาบที่ (ถ้ามี)</Label>
                <Input id="period" type="number" name="period" min={1} max={8} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="subjectId">วิชาที่เปลี่ยนเป็น (ถ้ามี)</Label>
                <select id="subjectId" name="subjectId" className="h-9 w-full rounded-md border bg-background px-3 text-sm">
                  <option value="">—</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">หมายเหตุ</Label>
              <Input id="note" type="text" name="note" />
            </div>
            <Button type="submit" className="self-start">
              เพิ่ม
            </Button>
          </form>
        </CardContent>
      </Card>

      <ul className="flex flex-col gap-2">
        {exceptions.map((e) => (
          <li key={e.id}>
            <Card>
              <CardContent className="flex items-center justify-between gap-2 py-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground">
                    {DateTime.fromJSDate(e.date, { zone: "utc" }).toFormat("d LLL yyyy")}
                  </span>
                  <StatusBadge tone={KIND_TONE[e.kind as keyof typeof KIND_TONE]}>{KIND_LABEL[e.kind]}</StatusBadge>
                  {e.period && <span className="text-muted-foreground">คาบ {e.period}</span>}
                  {e.note && <span className="text-muted-foreground">{e.note}</span>}
                </div>
                <form action={deleteExceptionAction}>
                  <input type="hidden" name="exceptionId" value={e.id} />
                  <input type="hidden" name="classroomId" value={classroom.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
