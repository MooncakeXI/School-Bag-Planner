import Link from "next/link";
import { Check, PartyPopper } from "lucide-react";
import { getPackingStatus, packingFocusDate } from "@/lib/packing";
import { schoolSettingsForStudent } from "@/lib/school-settings";
import { balance, computeStreak } from "@/lib/points";
import { schoolToday, schoolDateToUtcMidnight, SCHOOL_TZ } from "@/lib/time";
import { SubjectChip } from "@/components/subject-chip";
import { cn } from "@/lib/utils";

// timeZone pinned to SCHOOL_TZ — a SchoolDate is a Bangkok calendar date, and
// formatting it without pinning the zone would drift a day on a non-Bangkok
// server, per CLAUDE.md's date-handling rule.
const DATE_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: SCHOOL_TZ,
});

const RING_RADIUS = 34;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Shared between /student/tomorrow (self, interactive) and
 * /parent/[studentId] (guardian view, read-only — CLAUDE.md "parent never
 * ticks for their child"). Every checked state here comes from a real
 * server-recorded QR scan (lib/packing.ts) — there is no client-side tick
 * path anywhere, per invariant 7, not even for the student.
 */
export async function TomorrowView({
  studentId,
  studentName,
  readOnly = false,
}: {
  studentId: string;
  studentName: string;
  readOnly?: boolean;
}) {
  const settings = await schoolSettingsForStudent(studentId);
  const date = packingFocusDate(settings);
  const isToday = date === schoolToday();
  const status = await getPackingStatus(studentId, date);

  const header = (
    <header>
      <p className="text-sm text-muted-foreground">สวัสดี {studentName}</p>
      <h1 className="mt-0.5 font-heading text-2xl font-semibold leading-tight">
        {isToday ? "วันนี้" : "พรุ่งนี้"} {DATE_FMT.format(schoolDateToUtcMidnight(date))}
      </h1>
    </header>
  );

  if (status.isHoliday) {
    return (
      <div className="flex flex-col gap-5 max-w-lg mx-auto w-full">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-success/15 py-10 text-center">
          <PartyPopper className="size-10 text-success" />
          <p className="font-heading text-2xl font-semibold text-success">{isToday ? "วันนี้ไม่มีเรียน" : "พรุ่งนี้ไม่มีเรียน"}</p>
        </div>
      </div>
    );
  }

  if (status.total === 0) {
    return (
      <div className="flex flex-col gap-5 max-w-lg mx-auto w-full">
        {header}
        <div className="rounded-3xl bg-muted py-10 text-center text-lg text-muted-foreground">
          {isToday ? "ยังไม่มีของที่ต้องเตรียมสำหรับวันนี้" : "ยังไม่มีของที่ต้องเตรียมสำหรับพรุ่งนี้"}
        </div>
      </div>
    );
  }

  if (status.isComplete) {
    const [totalPoints, streak] = await Promise.all([balance(studentId), computeStreak(studentId, schoolToday())]);
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl bg-success px-6 py-10 text-center text-success-foreground">
        <div className="flex size-24 items-center justify-center rounded-full bg-white/20">
          <Check className="size-11" strokeWidth={2.6} />
        </div>
        <div>
          <p className="font-heading text-3xl font-semibold">จัดกระเป๋าครบแล้ว</p>
          <p className="mt-2 text-base opacity-90">{isToday ? "วันนี้ไม่ลืมอะไรแน่นอน" : "พรุ่งนี้ไม่ลืมอะไรแน่นอน"}</p>
        </div>
        <div className="flex w-full divide-x divide-white/20 rounded-2xl bg-white/10 p-5">
          <div className="flex-1">
            <p className="font-heading text-2xl font-semibold">+{status.pointsPerCompletion}</p>
            <p className="mt-0.5 text-sm opacity-80">คะแนนวันนี้</p>
          </div>
          <div className="flex-1">
            <p className="font-heading text-2xl font-semibold">{streak}</p>
            <p className="mt-0.5 text-sm opacity-80">วันติดกัน</p>
          </div>
          <div className="flex-1">
            <p className="font-heading text-2xl font-semibold">{totalPoints}</p>
            <p className="mt-0.5 text-sm opacity-80">คะแนนสะสม</p>
          </div>
        </div>
      </div>
    );
  }

  const progressDash = `${(status.packedCount / status.total) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`;

  return (
    <div className="flex flex-col gap-5 max-w-lg mx-auto w-full">
      {header}

      <div className="flex items-center gap-5 rounded-3xl bg-primary px-5 py-5 text-primary-foreground shadow-lg shadow-primary/25">
        <svg width="72" height="72" viewBox="0 0 92 92" className="shrink-0">
          <circle cx="46" cy="46" r={RING_RADIUS} fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="11" />
          <circle
            cx="46"
            cy="46"
            r={RING_RADIUS}
            fill="none"
            stroke="#fff"
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={progressDash}
            transform="rotate(-90 46 46)"
          />
        </svg>
        <div>
          <p className="font-heading text-2xl font-semibold leading-tight">
            {status.packedCount} / {status.total}
          </p>
          <p className="mt-1 text-sm opacity-90">ยังขาดอีก {status.total - status.packedCount} อย่าง</p>
        </div>
      </div>

      {!readOnly && (
        <Link
          href="/student/scan"
          className="flex h-[68px] items-center justify-center rounded-2xl bg-foreground text-lg font-semibold text-background transition-transform active:scale-[0.98]"
        >
          สแกนหนังสือ
        </Link>
      )}

      <div className="flex items-baseline justify-between px-1">
        <h2 className="font-heading text-base font-semibold">ของที่ต้องเอาไป</h2>
        <span className="text-sm text-muted-foreground">
          {status.packedCount}/{status.total} แล้ว
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {status.items.map((item) => (
          <li key={item.itemCopyId}>
            <div
              className={cn(
                "flex items-center gap-3.5 rounded-2xl border px-4 py-3",
                item.checked ? "border-success/30 bg-success/10" : "border-border bg-card",
              )}
            >
              <SubjectChip subjectName={item.subjectName} />
              <div className="min-w-0 flex-1">
                <p className={cn("truncate text-[15.5px] font-semibold", item.checked && "text-success line-through")}>
                  {item.subjectItemName}
                </p>
                <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{item.subjectName}</p>
              </div>
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full border-2",
                  item.checked ? "border-success bg-success text-success-foreground" : "border-border bg-muted",
                )}
              >
                {item.checked && <Check className="size-4" strokeWidth={3} />}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
