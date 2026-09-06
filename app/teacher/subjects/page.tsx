import { Trash2, BookOpen } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { ListGroup, ListRow } from "@/components/ios-list";
import { StatusBadge } from "@/components/status-badge";
import { SubjectChip } from "@/components/subject-chip";
import { RowIcon } from "@/components/row-icon";
import {
  createSubjectAction,
  createSubjectItemAction,
  deleteSubjectAction,
  deleteSubjectItemAction,
  setSubjectItemForExamAction,
} from "./actions";

export default async function TeacherSubjectsPage() {
  const actor = await requireActor();

  // Catalog is per-school, not global (see ARCHITECTURE.md "Database
  // Architecture" — Subject now carries schoolId). A teacher's schools come
  // from their TeachingAssignments; almost always exactly one today.
  const schools = await prisma.school.findMany({
    where: { classrooms: { some: { teachingAssignments: { some: { teacherId: actor.teacherId! } } } } },
    select: { id: true, name: true },
  });
  const schoolIds = schools.map((s) => s.id);

  // Archived subjects/items are hidden here — they still resolve correctly
  // for a student with an existing ItemCopy (see requiredItemsFor), they
  // just can't be assigned to anyone new. Restoring one is a lib/catalog.ts
  // function (restoreSubject/restoreSubjectItem) not yet wired to a button.
  const subjects = await prisma.subject.findMany({
    where: { schoolId: { in: schoolIds }, archivedAt: null },
    select: {
      id: true,
      name: true,
      subjectItems: { where: { archivedAt: null }, select: { id: true, name: true, forExam: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="วิชาและอุปกรณ์การเรียน"
        subtitle="รายวิชาและของที่ต้องเตรียมต่อวิชา — ใช้ร่วมกันทุกห้องเรียนในโรงเรียน ทำเครื่องหมาย “ชุดสอบ” ให้ของที่ต้องเตรียมเฉพาะวันสอบ (เช่น ดินสอ 2B ยางลบ ไม้บรรทัด) แทนที่แบบฝึกหัดปกติของวิชานั้นในวันที่มีสอบ"
      />

      <div className="flex flex-col gap-5">
        {subjects.map((subject) => (
          <ListGroup
            key={subject.id}
            label={
              <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                <SubjectChip subjectName={subject.name} className="size-5 text-[8px]" />
                {subject.name}
              </span>
            }
            footer={
              <form action={deleteSubjectAction} className="pt-0.5">
                <input type="hidden" name="subjectId" value={subject.id} />
                <button type="submit" className="text-xs font-medium text-destructive">
                  เก็บวิชานี้เข้าคลัง (ไม่แสดงในรายการอีก)
                </button>
              </form>
            }
          >
            {subject.subjectItems.map((item) => (
              <ListRow
                key={item.id}
                chevron={false}
                leading={<RowIcon icon={BookOpen} tone={item.forExam ? "warning" : "primary"} />}
                trailing={
                  <div className="flex items-center gap-1">
                    <form action={setSubjectItemForExamAction}>
                      <input type="hidden" name="subjectItemId" value={item.id} />
                      <input type="hidden" name="forExam" value={(!item.forExam).toString()} />
                      <Button
                        type="submit"
                        variant={item.forExam ? "secondary" : "ghost"}
                        size="sm"
                        className="h-8 rounded-lg px-2 text-xs"
                      >
                        ชุดสอบ
                      </Button>
                    </form>
                    <form action={deleteSubjectItemAction}>
                      <input type="hidden" name="subjectItemId" value={item.id} />
                      <Button type="submit" variant="ghost" size="icon" className="size-9" aria-label="เก็บเข้าคลัง">
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </form>
                  </div>
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">{item.name}</span>
                  {item.forExam && <StatusBadge tone="info">ชุดสอบ</StatusBadge>}
                </div>
              </ListRow>
            ))}
            <form action={createSubjectItemAction} className="flex flex-wrap items-center gap-2 p-3">
              <input type="hidden" name="subjectId" value={subject.id} />
              <Input name="name" placeholder="เพิ่มของที่ต้องเตรียม เช่น แบบฝึกหัด..." className="h-10 text-sm" required />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" name="forExam" className="size-4" />
                สำหรับวันสอบ
              </label>
              <Button type="submit" className="min-h-10 rounded-xl" variant="outline">
                เพิ่ม
              </Button>
            </form>
          </ListGroup>
        ))}
      </div>

      {schools.length === 0 ? (
        <p className="text-sm text-muted-foreground">บัญชีนี้ยังไม่มีห้องเรียนผูกอยู่ จึงยังเพิ่มวิชาไม่ได้</p>
      ) : (
        <Card className="rounded-3xl">
          <CardHeader>
            <CardTitle className="text-base">เพิ่มวิชาใหม่</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createSubjectAction} className="flex items-center gap-2">
              {schools.length > 1 ? (
                <select name="schoolId" className="h-11 rounded-xl border bg-background px-3 text-sm">
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="hidden" name="schoolId" value={schools[0].id} />
              )}
              <Input name="name" placeholder="ชื่อวิชา" className="h-11" required />
              <Button type="submit" className="min-h-11 rounded-xl">
                เพิ่ม
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
