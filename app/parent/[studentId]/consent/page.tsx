import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireActor } from "@/lib/session";
import { can } from "@/lib/policy";
import { prisma } from "@/lib/prisma";
import { hasActiveConsent } from "@/lib/consent";
import { photoStorageSummary } from "@/lib/photo-storage";
import { SCHOOL_TZ } from "@/lib/time";
import { cn } from "@/lib/utils";
import { grantConsentAction, revokeConsentAction } from "./actions";

const DATE_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: SCHOOL_TZ,
});

// PDPA lawful-basis screen (CLAUDE.md "Privacy") — grant/revoke, and see
// what's stored (a count + date range, never the images themselves here).
// Revoking deletes every stored photo immediately (lib/consent.ts's
// revokeConsent), not just stops future capture.
export default async function ParentConsentPage({ params }: { params: Promise<{ studentId: string }> }) {
  const actor = await requireActor();
  const { studentId } = await params;

  const allowed = await can(actor, "view_student", { type: "student", studentId });
  if (!allowed) notFound();

  const student = await prisma.student.findUniqueOrThrow({ where: { id: studentId }, select: { name: true } });
  const [active, summary] = await Promise.all([
    hasActiveConsent(studentId, "PHOTO_CAPTURE"),
    photoStorageSummary(studentId),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-6 pt-4">
      <Link href={`/parent/${studentId}`} className="flex items-center gap-1 text-sm text-muted-foreground">
        <ChevronLeft className="size-4" />
        กลับ
      </Link>

      <header>
        <h1 className="font-heading text-2xl font-semibold">ความยินยอมถ่ายรูป</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {student.name} — ทุกครั้งที่สแกน QR แอปจะถ่ายภาพหน้าปกหนังสือเก็บไว้เป็นข้อมูลสำหรับพัฒนาระบบในอนาคต
          ต้องได้รับความยินยอมจากผู้ปกครองก่อนจึงจะเก็บภาพได้ ไม่ยินยอมก็ยังสแกนจัดกระเป๋าได้ตามปกติ
          เพียงแต่จะไม่มีการถ่ายภาพเก็บไว้
        </p>
      </header>

      <div className={cn("rounded-3xl p-5", active ? "bg-success/15" : "bg-muted")}>
        <p className={cn("font-heading text-lg font-semibold", active ? "text-success" : "text-foreground")}>
          {active ? "ให้ความยินยอมแล้ว" : "ยังไม่ได้ให้ความยินยอม"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {active
            ? "แอปจะถ่ายภาพหน้าปกหนังสือทุกครั้งที่ลูกสแกน QR"
            : "แอปจะไม่ถ่ายภาพใด ๆ จนกว่าจะให้ความยินยอม"}
        </p>
        <form action={active ? revokeConsentAction : grantConsentAction} className="mt-4">
          <input type="hidden" name="studentId" value={studentId} />
          <button
            type="submit"
            className={cn(
              "h-[46px] w-full rounded-2xl text-[15px] font-semibold",
              active ? "bg-destructive/10 text-destructive" : "bg-primary text-primary-foreground",
            )}
          >
            {active ? "ยกเลิกความยินยอม" : "ให้ความยินยอม"}
          </button>
        </form>
        {active && (
          <p className="mt-2 text-xs text-muted-foreground">การยกเลิกจะลบภาพที่เก็บไว้ทั้งหมดทันที ไม่ใช่แค่หยุดถ่ายภาพต่อไป</p>
        )}
      </div>

      <div className="rounded-3xl border border-border bg-card p-5">
        <p className="font-heading text-base font-semibold">ภาพที่เก็บไว้ตอนนี้</p>
        {summary.count === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">ยังไม่มีภาพที่เก็บไว้</p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.count} ภาพ ตั้งแต่ {DATE_FMT.format(summary.earliest!)} ถึง {DATE_FMT.format(summary.latest!)}
          </p>
        )}
      </div>
    </main>
  );
}
