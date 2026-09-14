import Link from "next/link";
import { Archive, BookOpen, ChevronDown, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { ListRow } from "@/components/ios-list";
import { StatusBadge } from "@/components/status-badge";
import { SubjectChip } from "@/components/subject-chip";
import { RowIcon } from "@/components/row-icon";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import {
  createSubjectAction,
  createSubjectItemAction,
  deleteSubjectAction,
  deleteSubjectItemAction,
  setSubjectItemForExamAction,
} from "./actions";

const GRADES = ["1", "2", "3", "4", "5", "6"];

export default async function TeacherSubjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; grade?: string; scope?: string }>;
}) {
  const actor = await requireActor();
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const grade = GRADES.includes(params.grade ?? "") ? params.grade! : "";
  const scope = params.scope === "all" ? "all" : "mine";

  const schools = await prisma.school.findMany({
    where: { classrooms: { some: { teachingAssignments: { some: { teacherId: actor.teacherId! } } } } },
    select: { id: true, name: true },
  });
  const schoolIds = schools.map((school) => school.id);

  const subjects = await prisma.subject.findMany({
    where: {
      schoolId: { in: schoolIds },
      archivedAt: null,
      ...(scope === "mine" ? { teachingAssignments: { some: { teacherId: actor.teacherId! } } } : {}),
      AND: [
        ...(query ? [{ name: { contains: query, mode: "insensitive" as const } }] : []),
        ...(grade ? [{ name: { contains: `ป.${grade}` } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      subjectItems: { where: { archivedAt: null }, select: { id: true, name: true, forExam: true } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="วิชาและอุปกรณ์การเรียน" subtitle="ค้นหาวิชาที่ต้องการ แล้วเปิดเฉพาะรายการที่ต้องแก้ไข" />

      {schools.length > 0 && (
        <details className="group overflow-hidden rounded-3xl bg-card ring-1 ring-border shadow-[0_8px_24px_-8px_rgba(0,0,0,0.12)]">
          <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-5 font-heading text-lg font-semibold [&::-webkit-details-marker]:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Plus className="size-5" aria-hidden />
            </span>
            เพิ่มวิชาใหม่
            <ChevronDown className="ml-auto size-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <form action={createSubjectAction} className="grid gap-3 border-t border-border p-5 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            {schools.length > 1 ? (
              <label className="flex flex-col gap-1.5 text-sm font-semibold">
                โรงเรียน
                <select name="schoolId" className="rounded-xl border bg-background px-3">
                  {schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="schoolId" value={schools[0].id} />
            )}
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              ชื่อวิชา
              <Input name="name" placeholder="เช่น คณิตศาสตร์ ป.4" required />
            </label>
            <Button type="submit" className="rounded-xl">
              เพิ่มวิชา
            </Button>
          </form>
        </details>
      )}

      <form action="/teacher/subjects" method="get" className="grid gap-3 rounded-3xl bg-card p-4 ring-1 ring-border sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          ค้นหาชื่อวิชา
          <Input name="q" defaultValue={query} placeholder="เช่น วิทยาศาสตร์" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          รายการ
          <select name="scope" defaultValue={scope} className="rounded-xl border bg-background px-3">
            <option value="mine">วิชาที่ฉันสอน</option>
            <option value="all">ทุกวิชาในโรงเรียน</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-semibold">
          ระดับชั้น
          <select name="grade" defaultValue={grade} className="rounded-xl border bg-background px-3">
            <option value="">ทุกชั้น</option>
            {GRADES.map((item) => (
              <option key={item} value={item}>
                ป.{item}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2">
          <Button type="submit" className="min-h-11 flex-1 rounded-xl">
            <Search className="size-4" aria-hidden />
            ค้นหา
          </Button>
          {(query || grade || scope === "all") && (
            <Button variant="ghost" className="min-h-11 rounded-xl" nativeButton={false} render={<Link href="/teacher/subjects">ล้าง</Link>} />
          )}
        </div>
      </form>

      <p className="px-1 text-sm text-muted-foreground">พบ {subjects.length} วิชา · แตะชื่อวิชาเพื่อดูอุปกรณ์</p>

      {subjects.length === 0 ? (
        <div className="rounded-3xl bg-card px-5 py-10 text-center text-sm text-muted-foreground ring-1 ring-border">
          ไม่พบวิชาตามตัวกรองนี้
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {subjects.map((subject) => (
            <details key={subject.id} className="group overflow-hidden rounded-3xl bg-card ring-1 ring-border shadow-[0_8px_24px_-8px_rgba(0,0,0,0.12)]">
              <summary className="flex min-h-18 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                <SubjectChip subjectName={subject.name} className="size-10" showIcon />
                <span className="min-w-0 flex-1">
                  <span className="block font-heading text-lg font-semibold">{subject.name}</span>
                  <span className="block text-sm text-muted-foreground">{subject.subjectItems.length} อุปกรณ์</span>
                </span>
                <ChevronDown className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>

              <div className="divide-y divide-border border-t border-border">
                {subject.subjectItems.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-muted-foreground">ยังไม่มีอุปกรณ์ในวิชานี้</p>
                ) : (
                  subject.subjectItems.map((item) => (
                    <ListRow
                      key={item.id}
                      chevron={false}
                      leading={<RowIcon icon={BookOpen} tone={item.forExam ? "warning" : "primary"} />}
                      trailing={
                        <div className="flex items-center gap-1">
                          <form action={setSubjectItemForExamAction}>
                            <input type="hidden" name="subjectItemId" value={item.id} />
                            <input type="hidden" name="forExam" value={(!item.forExam).toString()} />
                            <Button type="submit" variant={item.forExam ? "secondary" : "ghost"} size="sm" aria-pressed={item.forExam} className="min-h-11 rounded-xl px-3 text-xs">
                              {item.forExam ? "ใช้วันสอบ" : "วันปกติ"}
                            </Button>
                          </form>
                          <form action={deleteSubjectItemAction}>
                            <input type="hidden" name="subjectItemId" value={item.id} />
                            <ConfirmSubmitButton type="submit" variant="ghost" size="icon" className="size-11" aria-label={`เก็บ ${item.name} เข้าคลัง`} confirmMessage={`เก็บ “${item.name}” เข้าคลังใช่ไหม`}>
                              <Trash2 className="size-4 text-destructive" />
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{item.name}</span>
                        {item.forExam && <StatusBadge tone="info">ชุดสอบ</StatusBadge>}
                      </div>
                    </ListRow>
                  ))
                )}

                <details className="group/add bg-muted/35">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 px-4 font-semibold text-primary [&::-webkit-details-marker]:hidden">
                    <Plus className="size-5" aria-hidden />
                    เพิ่มอุปกรณ์ในวิชานี้
                    <ChevronDown className="ml-auto size-5 transition-transform group-open/add:rotate-180" aria-hidden />
                  </summary>
                  <form action={createSubjectItemAction} className="grid gap-3 border-t border-border p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
                    <input type="hidden" name="subjectId" value={subject.id} />
                    <label className="flex flex-col gap-1.5 text-sm font-semibold">
                      ชื่ออุปกรณ์
                      <Input name="name" placeholder="เช่น แบบฝึกหัด" required />
                    </label>
                    <label className="flex min-h-11 items-center gap-2 rounded-xl bg-card px-3 text-sm font-medium">
                      <input type="checkbox" name="forExam" className="size-5" />
                      สำหรับวันสอบ
                    </label>
                    <Button type="submit" className="rounded-xl">
                      เพิ่มอุปกรณ์
                    </Button>
                  </form>
                </details>

                <details className="group/options bg-muted/20">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 text-sm font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
                    <MoreHorizontal className="size-5" aria-hidden />
                    ตัวเลือกวิชา
                    <ChevronDown className="ml-auto size-4 transition-transform group-open/options:rotate-180" aria-hidden />
                  </summary>
                  <form action={deleteSubjectAction} className="border-t border-border p-3">
                    <input type="hidden" name="subjectId" value={subject.id} />
                    <ConfirmSubmitButton type="submit" variant="destructive" className="min-h-11 rounded-xl" confirmMessage={`เก็บวิชา “${subject.name}” เข้าคลังใช่ไหม`}>
                      <Archive className="size-4" aria-hidden />
                      เก็บวิชานี้เข้าคลัง
                    </ConfirmSubmitButton>
                  </form>
                </details>
              </div>
            </details>
          ))}
        </div>
      )}

      {schools.length === 0 && <p className="text-sm text-muted-foreground">บัญชีนี้ยังไม่มีห้องเรียนผูกอยู่ จึงยังเพิ่มวิชาไม่ได้</p>}
    </div>
  );
}
