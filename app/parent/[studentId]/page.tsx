import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { TomorrowView } from "@/components/tomorrow-view";
import { DateRangeTabs } from "@/components/date-range-tabs";

export default async function ParentChildPage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const actor = await requireActor();
  const { studentId } = await params;

  // Every access decision goes through can() — CLAUDE.md "Authorization".
  const allowed = await can(actor, "view_student", { type: "student", studentId });
  if (!allowed) notFound();

  const student = await prisma.student.findUniqueOrThrow({
    where: { id: studentId },
    select: { name: true },
  });

  return (
    <main className="flex flex-col gap-6 pt-4">
      <DateRangeTabs
        active="tomorrow"
        tomorrowHref={`/parent/${studentId}`}
        weekHref={`/parent/${studentId}/week`}
      />
      <TomorrowView studentId={studentId} studentName={student.name} readOnly />
    </main>
  );
}
