import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WeekView } from "@/components/week-view";

export default async function StudentWeekPage() {
  const actor = await requireActor();
  const studentId = actor.studentId!;
  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { name: true },
  });

  return (
    <main className="flex flex-col gap-6 pt-4">
      <WeekView studentId={studentId} studentName={student.name} />
    </main>
  );
}
