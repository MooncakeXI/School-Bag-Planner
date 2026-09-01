import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { TomorrowView } from "@/components/tomorrow-view";
import { NotificationOptIn } from "@/components/notification-opt-in";

export default async function StudentTomorrowPage() {
  const actor = await requireActor();
  const studentId = actor.studentId!;
  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { name: true },
  });

  return (
    <main className="flex flex-col gap-4 pt-4">
      <TomorrowView studentId={studentId} studentName={student.name} />
      <div className="mx-auto w-full max-w-lg">
        <NotificationOptIn />
      </div>
    </main>
  );
}
