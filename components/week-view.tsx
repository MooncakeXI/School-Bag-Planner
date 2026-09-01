import { PartyPopper } from "lucide-react";
import { requiredItemsForWeek } from "@/lib/required-items";
import { mondayOf, schoolToday, type SchoolDate } from "@/lib/time";
import { SubjectChip } from "@/components/subject-chip";
import { cn } from "@/lib/utils";

const WEEKDAY_LABEL: Record<string, string> = {
  MON: "จันทร์",
  TUE: "อังคาร",
  WED: "พุธ",
  THU: "พฤหัสบดี",
  FRI: "ศุกร์",
};

// Same oversized styling as TomorrowView — see the comment there.
export async function WeekView({ studentId, studentName }: { studentId: string; studentName: string }) {
  const weekStart = mondayOf(schoolToday());
  const days = await requiredItemsForWeek(studentId, weekStart);
  const today: SchoolDate = schoolToday();

  return (
    <div className="flex flex-col gap-5 max-w-lg mx-auto w-full">
      <header>
        <h1 className="font-heading text-2xl font-semibold leading-tight">ตารางเรียน{studentName}</h1>
      </header>

      <div className="flex flex-col gap-5">
        {days.map((day) => {
          const isToday = day.date === today;
          return (
            <section key={day.date} className="flex flex-col gap-2">
              <h2
                className={cn(
                  "inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 font-heading text-sm font-semibold",
                  isToday ? "bg-foreground text-background" : "text-muted-foreground",
                )}
              >
                วัน{WEEKDAY_LABEL[day.weekday]}
                {isToday && " · วันนี้"}
              </h2>

              {day.isHoliday ? (
                <div className="flex items-center gap-3 rounded-2xl bg-success/15 px-4 py-3.5">
                  <PartyPopper className="size-6 text-success" aria-hidden />
                  <p className="font-semibold text-success">ไม่มีเรียน</p>
                </div>
              ) : day.items.length === 0 ? (
                <div className="rounded-2xl bg-muted px-4 py-3.5 text-center text-muted-foreground">
                  ไม่มีของที่ต้องเตรียม
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {day.items.map((item) => (
                    <li key={item.itemCopyId}>
                      <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-2.5">
                        <SubjectChip subjectName={item.subjectName} className="size-9 text-[10.5px]" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-semibold">{item.subjectItemName}</p>
                          <p className="truncate text-[12px] text-muted-foreground">{item.subjectName}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
