import { notFound } from "next/navigation";
import { QrCode, Printer, UserPlus, ClipboardCheck, ScanLine, KeyRound, Users, Camera, Coins, Backpack, ChevronDown, Plus, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";
import { schoolDateToUtcMidnight, schoolToday } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { SubjectChip } from "@/components/subject-chip";
import { IssueCredentialsButton } from "@/components/issue-credentials-button";
import { PageHeader } from "@/components/page-header";
import { ListGroup, ListRow } from "@/components/ios-list";
import { SegmentedControl, SegmentedOption } from "@/components/ios-segmented-control";
import { ScanBindButton } from "@/components/scan-bind-button";
import { RapidBindButton } from "@/components/rapid-bind-button";
import { BulkAddItemsButton } from "@/components/bulk-add-items-button";
import { StudentDetailDialog } from "@/components/student-detail-dialog";
import { hasActiveConsent } from "@/lib/consent";
import { balance } from "@/lib/points";
import {
  bindCodeAction,
  createItemCopyAction,
  createStudentAction,
  linkParentAction,
  manualAdjustPointsAction,
  rebindCodeAction,
  recordPaperConsentAction,
  revokeConsentAction,
  setItemCopyStateAction,
  voidCodeAction,
} from "./actions";

// Small icon-prefixed section label, matching the iOS Settings.app grouped-
// list convention — ListGroup's `label` already accepts any ReactNode, so
// this needs no change to that component.
function GroupLabel({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
      <Icon className="size-3.5" />
      {children}
    </span>
  );
}

export default async function ClassroomRosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ myOnly?: string }>;
}) {
  const actor = await requireActor();
  const { id: classroomId } = await params;
  const { myOnly } = await searchParams;

  const allowed = await can(actor, "edit_roster", { type: "classroom", classroomId });
  if (!allowed) notFound();

  const classroom = await prisma.classroom.findUniqueOrThrow({
    where: { id: classroomId },
    select: { id: true, name: true, schoolId: true, homeroomTeacherId: true },
  });
  const isHomeroomTeacher = classroom.homeroomTeacherId === actor.teacherId;
  // A subject-only teacher never has a choice here (always scoped to their
  // own subjects below) — this toggle exists purely for the homeroom
  // teacher, who normally sees every subject's equipment (their real,
  // documented scope — CLAUDE.md/ARCHITECTURE.md §4.4/§4.5, "do not
  // subject-scope this back") and can optionally narrow the "อุปกรณ์การเรียน"
  // section to just their own subjects for a quick look, without losing
  // that broader access — this is a display filter, not a policy change,
  // so it never touches can()/edit_item_copy.
  const showMyItemsOnly = isHomeroomTeacher && myOnly === "true";

  // Scoped to THIS teacher's own assignments, not every subject taught in
  // the classroom — a teacher covering only one subject must not see or
  // manage another subject's workbooks (real teachers are subject-specific).
  // The homeroom teacher (ครูประจำชั้น) is the one exception: they see every
  // subject, matching their broader edit_student_account rights below —
  // unless they've switched on showMyItemsOnly above.
  const subjectsHere = await prisma.subject.findMany({
    where: {
      teachingAssignments:
        isHomeroomTeacher && !showMyItemsOnly
          ? { some: { classroomId } }
          : { some: { classroomId, teacherId: actor.teacherId! } },
    },
    // Deliberately NOT filtered by archivedAt here: subjectIdsHere below
    // scopes which of a student's EXISTING item copies this teacher can see
    // (including ones whose subject/item was since archived — a teacher
    // must not lose visibility into something a student still has to pack).
    select: { id: true, subjectItems: { select: { id: true, name: true, archivedAt: true } } },
  });
  const subjectIdsHere = subjectsHere.map((s) => s.id);
  // Archived items ARE excluded here — this list only drives the "add a new
  // copy of this item" prompt, and an archived item can no longer be
  // assigned to anyone new (enforced again server-side in createItemCopy).
  const subjectItemsHere = subjectsHere.flatMap((s) => s.subjectItems).filter((si) => !si.archivedAt);

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
        // Stable order — rapid-bind (below) walks this same sequence to
        // pick "the next unbound item," and it must not shuffle between
        // renders/scans.
        orderBy: { createdAt: "asc" },
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

  // Only fetched for the homeroom teacher — consent is homeroom-only
  // (lib/consent.ts), so a subject teacher never sees this section at all.
  const consentByStudent = isHomeroomTeacher
    ? new Map(await Promise.all(students.map(async (s) => [s.id, await hasActiveConsent(s.id, "PHOTO_CAPTURE")] as const)))
    : new Map<string, boolean>();

  // Same homeroom-only gate as the manual-adjust form itself
  // (manualAdjustPoints, lib/points.ts) — shown so a teacher can see the
  // current balance before deciding on a correction, not just blindly
  // submit a delta.
  const balanceByStudent = isHomeroomTeacher
    ? new Map(await Promise.all(students.map(async (s) => [s.id, await balance(s.id)] as const)))
    : new Map<string, number>();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader title={classroom.name} subtitle="แตะชื่อนักเรียนเพื่อเปิดบัญชี ผู้ปกครอง แต้ม และอุปกรณ์" />
        {isHomeroomTeacher && (
          <SegmentedControl className="self-start">
            <Link
              href={`/teacher/classrooms/${classroomId}`}
              className={cn(
                "flex min-h-11 items-center rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                !showMyItemsOnly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              ทุกวิชา
            </Link>
            <Link
              href={`/teacher/classrooms/${classroomId}?myOnly=true`}
              className={cn(
                "flex min-h-11 items-center rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
                showMyItemsOnly ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              วิชาของฉัน
            </Link>
          </SegmentedControl>
        )}
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
          {isHomeroomTeacher && (
            <Button
              variant="outline"
              className="min-h-11 rounded-2xl"
              nativeButton={false}
              render={
                <Link href={`/teacher/classrooms/${classroomId}/today`}>
                  <ClipboardCheck />
                  ใครจัดกระเป๋าแล้ว
                </Link>
              }
            />
          )}
          <Button
            variant="outline"
            className="min-h-11 rounded-2xl"
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

      <BulkAddItemsButton classroomId={classroomId} items={subjectItemsHere} />

      <div className="flex flex-col gap-4">
        {students.map((student) => {
          const coveredSubjectItemIds = new Set(student.itemCopies.map((ic) => ic.subjectItem.id));
          const missingSubjectItems = subjectItemsHere.filter((si) => !coveredSubjectItemIds.has(si.id));
          const boundItemCount = student.itemCopies.filter((ic) => ic.qrCodes.length > 0).length;

          return (
            <StudentDetailDialog
              key={student.id}
              name={student.name}
              meta={`QR ${boundItemCount}/${student.itemCopies.length} รายการ`}
              actions={
                isHomeroomTeacher ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="self-start rounded-xl"
                    nativeButton={false}
                    render={
                      <Link href={`/teacher/classrooms/${classroomId}/pack/${student.id}`}>
                        <ScanLine className="size-3.5" />
                        จัดกระเป๋าให้
                      </Link>
                    }
                  />
                ) : undefined
              }
              account={
                <ListGroup label={<GroupLabel icon={KeyRound}>บัญชีเข้าใช้งาน (สำหรับนักเรียน)</GroupLabel>}>
                  <ListRow
                    chevron={false}
                    trailing={
                      isHomeroomTeacher && (
                        <IssueCredentialsButton studentId={student.id} hasCode={student.studentCode !== null} />
                      )
                    }
                  >
                    {student.studentCode ? (
                      <span className="text-sm text-muted-foreground">
                        รหัสนักเรียน: <span className="font-mono text-foreground">{student.studentCode}</span>
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">ยังไม่มีรหัสเข้าใช้งาน</span>
                    )}
                  </ListRow>
                </ListGroup>
              }
              guardians={
                <div className="flex flex-col gap-4">
                  <ListGroup label={<GroupLabel icon={Users}>ผู้ปกครอง</GroupLabel>}>
                  {student.guardianships.length === 0 ? (
                    <ListRow chevron={false}>
                      <span className="text-sm text-muted-foreground">ยังไม่มีผู้ปกครองผูกไว้</span>
                    </ListRow>
                  ) : (
                    student.guardianships.map((g) => (
                      <ListRow key={g.parent.email} chevron={false}>
                        <span className="text-sm">
                          {g.parent.name} · <span className="text-muted-foreground">{g.parent.email}</span>
                        </span>
                      </ListRow>
                    ))
                  )}
                  {isHomeroomTeacher && (
                    <div className="bg-muted/35 p-4">
                      <p className="mb-3 text-sm font-semibold">เพิ่มผู้ปกครอง</p>
                      <form action={linkParentAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                        <input type="hidden" name="classroomId" value={classroomId} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <label className="flex flex-col gap-1.5 text-sm font-medium">
                          ชื่อผู้ปกครอง
                          <Input name="name" placeholder="ชื่อ-นามสกุล" required />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm font-medium">
                          อีเมล
                          <Input name="email" type="email" placeholder="name@example.com" required />
                        </label>
                        <Button type="submit" className="rounded-xl" variant="outline">
                          <UserPlus className="size-3.5" />
                          เพิ่มผู้ปกครอง
                        </Button>
                      </form>
                    </div>
                  )}
                  </ListGroup>

                  {isHomeroomTeacher && (
                    <ListGroup label={<GroupLabel icon={Camera}>ความยินยอมถ่ายรูป</GroupLabel>}>
                    <ListRow chevron={false}>
                      <span className="text-sm text-muted-foreground">
                        {consentByStudent.get(student.id) ? "ให้ความยินยอมแล้ว" : "ยังไม่ได้ให้ความยินยอม"}
                      </span>
                    </ListRow>
                    <div className="p-3">
                      {consentByStudent.get(student.id) ? (
                        <form action={revokeConsentAction}>
                          <input type="hidden" name="classroomId" value={classroomId} />
                          <input type="hidden" name="studentId" value={student.id} />
                          <Button type="submit" variant="ghost" size="sm" className="min-h-9 text-destructive">
                            ยกเลิกความยินยอม
                          </Button>
                        </form>
                      ) : (
                        <form action={recordPaperConsentAction}>
                          <input type="hidden" name="classroomId" value={classroomId} />
                          <input type="hidden" name="studentId" value={student.id} />
                          <Button type="submit" variant="outline" size="sm" className="min-h-9">
                            บันทึกความยินยอม (แบบฟอร์มกระดาษ)
                          </Button>
                        </form>
                      )}
                    </div>
                    </ListGroup>
                  )}
                </div>
              }
              points={
                isHomeroomTeacher ? (
                  <ListGroup label={<GroupLabel icon={Coins}>แต้มสะสม</GroupLabel>}>
                    <ListRow chevron={false}>
                      <span className="text-sm text-muted-foreground">
                        แต้มปัจจุบัน: <span className="font-mono text-foreground">{balanceByStudent.get(student.id)}</span>
                      </span>
                    </ListRow>
                    <div className="bg-muted/35 p-4">
                      <p className="mb-3 text-sm font-semibold">ปรับแต้มด้วยตนเอง</p>
                      <form action={manualAdjustPointsAction} className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
                        <input type="hidden" name="classroomId" value={classroomId} />
                        <input type="hidden" name="studentId" value={student.id} />
                        <label className="flex flex-col gap-1.5 text-sm font-medium">
                          จำนวนแต้ม
                          <Input name="delta" type="number" placeholder="เช่น +5 หรือ -2" required />
                        </label>
                        <label className="flex flex-col gap-1.5 text-sm font-medium">
                          เหตุผล
                          <Input name="note" placeholder="ระบุเหตุผลที่ปรับแต้ม" required />
                        </label>
                        <Button type="submit" variant="outline" size="sm" className="rounded-xl">
                          ปรับแต้ม
                        </Button>
                      </form>
                    </div>
                  </ListGroup>
                ) : undefined
              }
              items={
                <ListGroup
                  label={<GroupLabel icon={Backpack}>อุปกรณ์การเรียน</GroupLabel>}
                  action={
                    <RapidBindButton
                      targets={student.itemCopies.map((ic) => ({
                        itemCopyId: ic.id,
                        label: ic.subjectItem.name,
                        bound: ic.qrCodes.length > 0,
                      }))}
                      disabled={student.itemCopies.every((ic) => ic.qrCodes.length > 0)}
                    />
                  }
                >
                  {student.itemCopies.map((ic) => {
                    const currentCode = ic.qrCodes[0]?.code;
                    return (
                      <div key={ic.id} className="flex flex-col gap-2.5 p-3">
                        <div className="flex items-center gap-2.5 text-sm">
                          <SubjectChip subjectName={ic.subjectItem.subject.name} className="size-8" showIcon />
                          <div>
                            <p className="font-medium">{ic.subjectItem.name}</p>
                            <p className="text-xs text-muted-foreground">{ic.subjectItem.subject.name}</p>
                          </div>
                        </div>
                        <div className="grid gap-3 rounded-2xl bg-muted/50 p-3 sm:grid-cols-2">
                          <div className="flex flex-col gap-2">
                            <p className="text-xs font-semibold text-muted-foreground">สถานะสมุด</p>
                            <form action={setItemCopyStateAction}>
                              <input type="hidden" name="classroomId" value={classroomId} />
                              <input type="hidden" name="itemCopyId" value={ic.id} />
                              <SegmentedControl>
                                <SegmentedOption name="state" value="WITH_STUDENT" active={ic.state !== "GRADING"}>
                                  อยู่กับนักเรียน
                                </SegmentedOption>
                                <SegmentedOption name="state" value="GRADING" active={ic.state === "GRADING"}>
                                  ครูเก็บตรวจอยู่
                                </SegmentedOption>
                              </SegmentedControl>
                            </form>
                          </div>

                          <div className="flex flex-col gap-2">
                            <p className="text-xs font-semibold text-muted-foreground">สติกเกอร์ QR</p>
                            {currentCode ? (
                              <>
                                <div className="flex flex-wrap items-center gap-2">
                                  <StatusBadge tone="info">
                                    <QrCode className="mr-1 size-3" />
                                    {currentCode}
                                  </StatusBadge>
                                  <form action={voidCodeAction}>
                                    <input type="hidden" name="classroomId" value={classroomId} />
                                    <input type="hidden" name="code" value={currentCode} />
                                    <Button type="submit" variant="ghost" size="sm" className="px-2 text-xs text-destructive">
                                      ยกเลิก QR
                                    </Button>
                                  </form>
                                </div>
                                <details>
                                  <summary className="cursor-pointer text-sm font-semibold text-primary">เปลี่ยนสติกเกอร์</summary>
                                  <form action={rebindCodeAction} className="mt-2 flex flex-wrap gap-2">
                                    <input type="hidden" name="classroomId" value={classroomId} />
                                    <input type="hidden" name="itemCopyId" value={ic.id} />
                                    <Input name="newCode" placeholder="รหัส QR ใหม่" className="min-w-40 flex-1" />
                                    <Button type="submit" variant="outline" size="sm">
                                      บันทึก
                                    </Button>
                                  </form>
                                </details>
                              </>
                            ) : (
                              <>
                                <ScanBindButton itemCopyId={ic.id} label={ic.subjectItem.name} />
                                <details>
                                  <summary className="cursor-pointer text-sm font-semibold text-primary">หรือกรอกรหัส QR เอง</summary>
                                  <form action={bindCodeAction} className="mt-2 flex flex-wrap gap-2">
                                    <input type="hidden" name="classroomId" value={classroomId} />
                                    <input type="hidden" name="itemCopyId" value={ic.id} />
                                    <Input name="code" placeholder="รหัส QR" className="min-w-40 flex-1" required />
                                    <Button type="submit" variant="outline" size="sm">
                                      ผูกรหัส
                                    </Button>
                                  </form>
                                </details>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {missingSubjectItems.map((si) => (
                    <form key={si.id} action={createItemCopyAction} className="flex items-center justify-between gap-2 p-3">
                      <input type="hidden" name="classroomId" value={classroomId} />
                      <input type="hidden" name="studentId" value={student.id} />
                      <input type="hidden" name="subjectItemId" value={si.id} />
                      <span className="text-sm text-muted-foreground">{si.name} (ยังไม่มีเล่ม)</span>
                      <Button type="submit" variant="ghost" size="sm" className="min-h-9">
                        เพิ่มเล่ม
                      </Button>
                    </form>
                  ))}
                </ListGroup>
              }
            />
          );
        })}
      </div>

      <details className="group overflow-hidden rounded-3xl bg-card ring-1 ring-border shadow-[0_8px_24px_-8px_rgba(0,0,0,0.12)]">
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-5 font-heading text-lg font-semibold [&::-webkit-details-marker]:hidden">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Plus className="size-5" aria-hidden />
          </span>
          เพิ่มนักเรียน
          <ChevronDown className="ml-auto size-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <form action={createStudentAction} className="grid gap-3 border-t border-border p-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <input type="hidden" name="classroomId" value={classroomId} />
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              ชื่อนักเรียน
              <Input name="name" placeholder="เช่น มานี ใจดี" required />
            </label>
            <Button type="submit" className="rounded-xl">
              เพิ่มนักเรียน
            </Button>
        </form>
      </details>
    </div>
  );
}
