import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { requireHomeroomAccessForStudent } from "@/lib/roster";
import { getPackingStatus } from "@/lib/packing";
import { prisma } from "@/lib/prisma";
import { schoolTomorrow } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { TeacherScanView } from "@/components/teacher-scan-view";

export default async function TeacherPackPage({
  params,
}: {
  params: Promise<{ id: string; studentId: string }>;
}) {
  const actor = await requireActor();
  const { id: classroomId, studentId } = await params;

  // Resolved from the student's own current classroom, not the URL's :id —
  // see lib/roster.ts's requireHomeroomAccessForStudent. The URL's
  // classroomId is used only for the back link below, never for
  // authorization, so it can't be used to leak another classroom's student.
  try {
    await requireHomeroomAccessForStudent(actor, studentId);
  } catch {
    notFound();
  }

  const student = await prisma.student.findUnique({ where: { id: studentId }, select: { name: true } });
  if (!student) notFound();

  const forDate = schoolTomorrow();
  const status = await getPackingStatus(studentId, forDate);

  return (
    <div className="flex flex-col gap-4 pt-2">
      <PageHeader
        title={`จัดกระเป๋าให้ ${student.name}`}
        subtitle="ให้เด็กถือหนังสือ แล้วใช้กล้องเครื่องนี้สแกนสติกเกอร์ QR บนเล่มนั้น — สำหรับเด็กที่ไม่มีมือถือให้สแกนตอนเย็นที่บ้าน"
      />

      {status.isComplete || status.total === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          จัดกระเป๋าครบแล้วสำหรับพรุ่งนี้
        </div>
      ) : (
        <TeacherScanView classroomId={classroomId} studentId={studentId} items={status.items} />
      )}
    </div>
  );
}
