import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClassroomAction } from "./actions";

export default async function TeacherClassroomsPage() {
  const actor = await requireActor();

  const [classrooms, schools, subjects] = await Promise.all([
    prisma.classroom.findMany({
      where: visibleClassroomWhere(actor),
      select: { id: true, name: true, _count: { select: { enrollments: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.school.findMany({
      where: { classrooms: { some: { teachingAssignments: { some: { teacherId: actor.teacherId! } } } } },
      select: { id: true, name: true },
    }),
    prisma.subject.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">ห้องเรียน</h1>
        <p className="text-sm text-muted-foreground">ห้องเรียนที่คุณสอนอยู่</p>
      </div>

      <ul className="flex flex-col gap-2">
        {classrooms.map((c) => (
          <li key={c.id}>
            <Link href={`/teacher/classrooms/${c.id}`}>
              <Card className="transition-colors hover:bg-muted/50">
                <CardContent className="flex items-center justify-between py-3">
                  <span className="font-medium">{c.name}</span>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>{c._count.enrollments} คน</span>
                    <ChevronRight className="size-4" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>

      {schools.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          บัญชีนี้ยังไม่มีโรงเรียนผูกอยู่ กรุณาให้ผู้ดูแลระบบสร้างห้องเรียนแรกให้ก่อน
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="size-4" />
              เพิ่มห้องเรียนใหม่
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createClassroomAction} className="flex flex-col gap-4">
              {schools.length > 1 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="schoolId">โรงเรียน</Label>
                  <select
                    id="schoolId"
                    name="schoolId"
                    className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  >
                    {schools.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <input type="hidden" name="schoolId" value={schools[0].id} />
              )}

              <div className="space-y-1.5">
                <Label htmlFor="name">ชื่อห้องเรียน</Label>
                <Input id="name" name="name" placeholder="เช่น ป.4/2" required />
              </div>

              <div className="space-y-1.5">
                <Label>วิชาที่คุณจะสอนในห้องนี้</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {subjects.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="subjectIds" value={s.id} className="size-4 rounded border" />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>

              <Button type="submit" className="self-start">
                สร้างห้องเรียน
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
