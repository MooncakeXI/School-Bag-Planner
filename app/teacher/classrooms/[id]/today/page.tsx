import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { classroomTodayDashboard } from "@/lib/dashboard";
import { ForbiddenError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { StudentAvatar } from "@/components/student-avatar";
import { Button } from "@/components/ui/button";
import { spotCheckAction, bulkCollectAction } from "./actions";

const DATE_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { weekday: "long", day: "numeric", month: "long" });

const LEGEND = [
  { status: "complete" as const, label: "ครบ" },
  { status: "partial" as const, label: "ไม่ครบ" },
  { status: "not_started" as const, label: "ยังไม่เปิด" },
];

export default async function ClassroomTodayPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id: classroomId } = await params;

  let dashboard;
  try {
    dashboard = await classroomTodayDashboard(actor, classroomId);
  } catch (err) {
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const { packing, collectibleItems } = dashboard;
  const collectedToday = collectibleItems.reduce((sum, item) => sum + item.collectedCount, 0);
  const notSubmitted = packing?.students.filter((s) => s.status !== "complete") ?? [];
  // Only students with something checked need a human spot-check — this is
  // CLAUDE.md's actual anti-cheat mechanism, unchanged from the previous
  // per-student list, just filtered down to the ones worth a teacher's look.
  const spotCheckable = packing?.students.filter((s) => s.checkedItems.length > 0) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={DATE_FMT.format(new Date())} subtitle={`เช็กความพร้อมสำหรับพรุ่งนี้ · ${dashboard.classroomName}`} />

      {dashboard.isHoliday && (
        <div className="rounded-2xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          วันนี้เป็นวันหยุด ไม่มีคาบเรียน
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {packing && (
          <>
            <StatCard value={packing.completeCount} label="จัดครบแล้ว" tone="success" />
            <StatCard value={packing.partialCount} label="จัดไม่ครบ" tone="warning" />
            <StatCard value={packing.notStartedCount} label="ยังไม่เปิดแอป" tone="neutral" />
          </>
        )}
        <StatCard value={collectedToday} label="สมุดที่เก็บแล้ว" tone="primary" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {packing ? (
          <div className="rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-heading text-base font-semibold">ใครจัดกระเป๋าแล้ว</h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {LEGEND.map((l) => (
                  <span key={l.status} className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{
                        background:
                          l.status === "complete" ? "var(--success)" : l.status === "partial" ? "var(--warning)" : "var(--muted-foreground)",
                      }}
                    />
                    {l.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-x-3 gap-y-4 sm:grid-cols-6">
              {packing.students.map((s) => (
                <div key={s.id} className="flex flex-col items-center gap-1.5 text-center">
                  <StudentAvatar name={s.name} status={s.status} className="size-11 text-base" />
                  <span className="max-w-full truncate text-xs text-muted-foreground">{s.name}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border border-border bg-card p-5 text-sm text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
            ใครจัดกระเป๋าแล้วดูได้เฉพาะครูประจำชั้น — คุณเห็นเฉพาะรายการเก็บสมุดตรวจของวิชาที่คุณสอน
          </div>
        )}

        <div className="rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
          <h2 className="font-heading text-base font-semibold">เก็บสมุดตรวจวันนี้</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">แตะเพื่อบันทึกว่าเก็บครบทั้งห้องแล้ว</p>

          {collectibleItems.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">ไม่มีวิชาที่มีคาบวันนี้ (ในขอบเขตที่คุณจัดการได้)</p>
          ) : (
            <div className="mt-4 flex flex-col gap-2.5">
              {collectibleItems.map((item) => {
                const isCollected = item.totalStudents > 0 && item.collectedCount === item.totalStudents;
                return (
                  <div key={item.subjectItemId} className="flex items-center justify-between gap-3 rounded-2xl bg-muted/60 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.subjectItemName}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.periods.length > 0 ? `เก็บตอนคาบ ${item.periods.join(", ")} · ` : ""}
                        {item.collectedCount}/{item.totalStudents} คน
                      </p>
                    </div>
                    <form action={bulkCollectAction}>
                      <input type="hidden" name="classroomId" value={classroomId} />
                      <input type="hidden" name="subjectItemId" value={item.subjectItemId} />
                      <input type="hidden" name="collected" value={(!isCollected).toString()} />
                      <Button
                        type="submit"
                        size="sm"
                        variant={isCollected ? "secondary" : "outline"}
                        className="min-h-9 shrink-0 rounded-full"
                      >
                        {isCollected ? "เก็บแล้ว" : "ยังไม่เก็บ"}
                      </Button>
                    </form>
                  </div>
                );
              })}
            </div>
          )}

          {notSubmitted.length > 0 && (
            <div className="mt-5">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">นักเรียนที่ยังไม่ส่ง</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {notSubmitted.map((s) => (
                  <span key={s.id} className="rounded-full bg-warning-foreground px-2.5 py-1 text-xs font-medium text-warning">
                    {s.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {spotCheckable.length > 0 && (
        <div className="rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
          <h2 className="font-heading text-base font-semibold">ตรวจของที่นักเรียนสแกนไว้</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">ถ้าของไม่อยู่ในกระเป๋าจริง กดแจ้งเพื่อหักคะแนนและตัดสตรีค</p>
          <div className="mt-4 flex flex-col gap-3">
            {spotCheckable.map((s) => (
              <div key={s.id} className="rounded-2xl bg-muted/60 p-3.5">
                <div className="flex items-center gap-2.5">
                  <StudentAvatar name={s.name} status={s.status} className="size-8 text-sm" />
                  <p className="font-medium">{s.name}</p>
                  {!s.continuous && (
                    <span
                      title="สแกนไม่ต่อเนื่อง — เซสชันหมดเวลาระหว่างทาง แล้วสแกนต่อในรอบใหม่"
                      className="rounded-full bg-warning-foreground px-2 py-0.5 text-[11px] font-medium text-warning"
                    >
                      ไม่ต่อเนื่อง
                    </span>
                  )}
                </div>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {s.checkedItems.map((item) => (
                    <div key={item.itemCopyId} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">{item.subjectItemName}</span>
                      <form action={spotCheckAction}>
                        <input type="hidden" name="classroomId" value={classroomId} />
                        <input type="hidden" name="itemCopyId" value={item.itemCopyId} />
                        <Button type="submit" variant="ghost" size="sm" className="min-h-9 px-2 text-xs text-destructive">
                          ของไม่อยู่จริง
                        </Button>
                      </form>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ value, label, tone }: { value: number; label: string; tone: "success" | "warning" | "neutral" | "primary" }) {
  const TONE_TEXT = { success: "text-success", warning: "text-warning", neutral: "text-muted-foreground", primary: "text-primary" } as const;
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-border shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
      <p className={`font-heading text-3xl font-bold ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
