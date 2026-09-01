import { notFound } from "next/navigation";
import { QrCode, Printer, UserPlus, ClipboardCheck } from "lucide-react";
import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { schoolDateToUtcMidnight, schoolToday } from "@/lib/time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { SubjectChip } from "@/components/subject-chip";
import { IssueCredentialsButton } from "@/components/issue-credentials-button";
import {
  bindCodeAction,
  createItemCopyAction,
  createStudentAction,
  linkParentAction,
  rebindCodeAction,
  setItemCopyStateAction,
  transferStudentAction,
  voidCodeAction,
  withdrawStudentAction,
} from "./actions";

export default async function ClassroomRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id: classroomId } = await params;

  const allowed = await can(actor, "edit_roster", { type: "classroom", classroomId });
  if (!allowed) notFound();

  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: classroomId },
    select: { id: true, name: true, schoolId: true },
  });

  const [otherClassrooms, subjectsHere] = await Promise.all([
    prisma.classroom.findMany({
      where: { schoolId: classroom.schoolId, id: { not: classroomId } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.subject.findMany({
      where: { teachingAssignments: { some: { classroomId } } },
      select: { id: true, subjectItems: { select: { id: true, name: true } } },
    }),
  ]);
  const subjectIdsHere = subjectsHere.map((s) => s.id);
  const subjectItemsHere = subjectsHere.flatMap((s) => s.subjectItems);

  const today = schoolDateToUtcMidnight(schoolToday());
  const students = await prisma.student.findMany({
    where: { enrollments: { some: { classroomId, OR: [{ endDate: null }, { endDate: { gte: today } }] } } },
    select: {
      id: true,
      name: true,
      studentCode: true,
      guardianships: { select: { parent: { select: { name: true, email: true } } } },
      itemCopies: {
        where: { subjectItem: { subjectId: { in: subjectIdsHere } } },
        select: {
          id: true,
          state: true,
          subjectItem: { select: { id: true, name: true, subject: { select: { name: true } } } },
          qrCodes: { where: { state: "ASSIGNED" }, select: { code: true }, take: 1 },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-xl font-semibold">{classroom.name}</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/teacher/classrooms/${classroomId}/today`}>
                <ClipboardCheck />
                ใครจัดกระเป๋าแล้ว
              </Link>
            }
          />
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <Link href={`/teacher/classrooms/${classroomId}/print-qr`}>
                <Printer />
                พิมพ์ QR
              </Link>
            }
          />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {students.map((student) => {
          const coveredSubjectItemIds = new Set(student.itemCopies.map((ic) => ic.subjectItem.id));
          const missingSubjectItems = subjectItemsHere.filter((si) => !coveredSubjectItemIds.has(si.id));

          return (
            <Card key={student.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{student.name}</CardTitle>
                  <div className="flex items-center gap-2">
                    {otherClassrooms.length > 0 && (
                      <form action={transferStudentAction} className="flex items-center gap-1">
                        <input type="hidden" name="classroomId" value={classroomId} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <select name="toClassroomId" className="h-8 rounded-md border bg-background px-2 text-xs">
                          {otherClassrooms.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <Button type="submit" variant="outline" size="sm">
                          โอนย้าย
                        </Button>
                      </form>
                    )}
                    <form action={withdrawStudentAction}>
                      <input type="hidden" name="classroomId" value={classroomId} />
                      <input type="hidden" name="studentId" value={student.id} />
                      <Button type="submit" variant="destructive" size="sm">
                        ถอนชื่อ
                      </Button>
                    </form>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">บัญชีเข้าใช้งาน (สำหรับนักเรียน)</p>
                  <div className="flex flex-wrap items-center gap-2">
                    {student.studentCode && (
                      <span className="text-sm text-muted-foreground">
                        รหัสนักเรียน: <span className="font-mono">{student.studentCode}</span>
                      </span>
                    )}
                    <IssueCredentialsButton studentId={student.id} hasCode={student.studentCode !== null} />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-xs font-medium text-muted-foreground">ผู้ปกครอง</p>
                  {student.guardianships.length === 0 ? (
                    <p className="text-sm text-muted-foreground">ยังไม่มีผู้ปกครองผูกไว้</p>
                  ) : (
                    <ul className="text-sm">
                      {student.guardianships.map((g) => (
                        <li key={g.parent.email}>
                          {g.parent.name} · {g.parent.email}
                        </li>
                      ))}
                    </ul>
                  )}
                  <form action={linkParentAction} className="flex flex-wrap items-center gap-2 pt-1">
                    <input type="hidden" name="classroomId" value={classroomId} />
                    <input type="hidden" name="studentId" value={student.id} />
                    <Input name="name" placeholder="ชื่อผู้ปกครอง" className="h-8 w-36 text-xs" required />
                    <Input name="email" type="email" placeholder="อีเมล" className="h-8 w-48 text-xs" required />
                    <Button type="submit" size="sm" variant="outline">
                      <UserPlus className="size-3.5" />
                      เพิ่ม
                    </Button>
                  </form>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">อุปกรณ์การเรียน</p>
                  {student.itemCopies.map((ic) => {
                    const currentCode = ic.qrCodes[0]?.code;
                    return (
                      <div
                        key={ic.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border p-2.5"
                      >
                        <div className="flex items-center gap-2.5 text-sm">
                          <SubjectChip subjectName={ic.subjectItem.subject.name} className="size-8 text-[10px]" />
                          <div>
                            <p className="font-medium">{ic.subjectItem.name}</p>
                            <p className="text-xs text-muted-foreground">{ic.subjectItem.subject.name}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={setItemCopyStateAction}>
                            <input type="hidden" name="classroomId" value={classroomId} />
                            <input type="hidden" name="itemCopyId" value={ic.id} />
                            <input type="hidden" name="state" value={ic.state === "GRADING" ? "WITH_STUDENT" : "GRADING"} />
                            <button type="submit">
                              <StatusBadge tone={ic.state === "GRADING" ? "warning" : "success"} className="cursor-pointer">
                                {ic.state === "GRADING" ? "ครูเก็บตรวจอยู่" : "อยู่กับนักเรียน"}
                              </StatusBadge>
                            </button>
                          </form>

                          {currentCode ? (
                            <div className="flex items-center gap-1">
                              <StatusBadge tone="info">
                                <QrCode className="mr-1 size-3" />
                                {currentCode}
                              </StatusBadge>
                              <form action={voidCodeAction}>
                                <input type="hidden" name="classroomId" value={classroomId} />
                                <input type="hidden" name="code" value={currentCode} />
                                <Button type="submit" variant="ghost" size="sm" className="h-6 px-2 text-xs">
                                  ยกเลิก
                                </Button>
                              </form>
                              <form action={rebindCodeAction} className="flex items-center gap-1">
                                <input type="hidden" name="classroomId" value={classroomId} />
                                <input type="hidden" name="itemCopyId" value={ic.id} />
                                <Input name="newCode" placeholder="รหัสใหม่" className="h-6 w-28 text-xs" />
                                <Button type="submit" variant="outline" size="sm" className="h-6 px-2 text-xs">
                                  เปลี่ยนสติกเกอร์
                                </Button>
                              </form>
                            </div>
                          ) : (
                            <form action={bindCodeAction} className="flex items-center gap-1">
                              <input type="hidden" name="classroomId" value={classroomId} />
                              <input type="hidden" name="itemCopyId" value={ic.id} />
                              <Input name="code" placeholder="พิมพ์รหัส QR" className="h-6 w-28 text-xs" required />
                              <Button type="submit" variant="outline" size="sm" className="h-6 px-2 text-xs">
                                ผูกรหัส
                              </Button>
                            </form>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {missingSubjectItems.map((si) => (
                    <form
                      key={si.id}
                      action={createItemCopyAction}
                      className="flex items-center justify-between rounded-md border border-dashed p-2"
                    >
                      <input type="hidden" name="classroomId" value={classroomId} />
                      <input type="hidden" name="studentId" value={student.id} />
                      <input type="hidden" name="subjectItemId" value={si.id} />
                      <span className="text-sm text-muted-foreground">{si.name} (ยังไม่มีเล่ม)</span>
                      <Button type="submit" variant="ghost" size="sm">
                        เพิ่มเล่ม
                      </Button>
                    </form>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เพิ่มนักเรียน</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createStudentAction} className="flex items-center gap-2">
            <input type="hidden" name="classroomId" value={classroomId} />
            <Input name="name" placeholder="ชื่อนักเรียน" required />
            <Button type="submit">เพิ่ม</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
