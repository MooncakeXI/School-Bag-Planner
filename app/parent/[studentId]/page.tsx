import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
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
      <Link
        href={`/parent/${studentId}/consent`}
        className="mx-auto flex w-full max-w-lg items-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground"
      >
        <ShieldCheck className="size-4 shrink-0" />
        ความยินยอมถ่ายรูป
      </Link>
    </main>
  );
}
