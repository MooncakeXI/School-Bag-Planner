import Link from "next/link";
import { Users, GraduationCap, ClipboardCheck, CalendarClock } from "lucide-react";
import { requireActor } from "@/lib/session";
import { teacherDashboard } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";

const TONES = {
  neutral: { chip: "bg-muted text-muted-foreground" },
  success: { chip: "bg-success/15 text-success" },
  warning: { chip: "bg-warning-foreground text-warning" },
} as const;

const KIND_LABEL: Record<string, string> = {
  HOLIDAY: "วันหยุด",
  PERIOD_SWAP: "สลับคาบ",
  EXAM: "วันสอบ",
  CANCELLED_PERIOD: "งดคาบเรียน",
};

const DATE_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short" });

export default async function TeacherDashboardPage() {
  const actor = await requireActor();
  const dashboard = await teacherDashboard(actor);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={Users} label="ห้องเรียนที่สอน" value={dashboard.classroomCount} tone="neutral" />
        <StatCard icon={GraduationCap} label="นักเรียนทั้งหมด" value={dashboard.studentCount} tone="success" />
        <StatCard icon={ClipboardCheck} label="กำลังตรวจ (GRADING)" value={dashboard.gradingCount} tone="warning" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">วันนี้สอนอะไรบ้าง</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {dashboard.todayByClassroom.length === 0 ? (
            <p className="text-sm text-muted-foreground">ยังไม่มีห้องเรียนที่คุณสอน</p>
          ) : (
            dashboard.todayByClassroom.map((c) => (
              <div key={c.classroomId} className="flex items-center justify-between gap-4 rounded-md border p-3">
                <Link href={`/teacher/classrooms/${c.classroomId}`} className="font-medium hover:underline">
                  {c.classroomName}
                </Link>
                {c.isHoliday ? (
                  <StatusBadge tone="success">วันหยุด</StatusBadge>
                ) : c.subjects.length === 0 ? (
                  <span className="text-sm text-muted-foreground">ไม่มีคาบวันนี้</span>
                ) : (
                  <div className="flex flex-wrap justify-end gap-1">
                    {c.subjects.map((s) => (
                      <StatusBadge key={s} tone="info">
                        {s}
                      </StatusBadge>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="size-4" />
            วันหยุด/สลับคาบที่จะถึง (14 วันข้างหน้า)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dashboard.upcomingExceptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">ไม่มีรายการในช่วงนี้</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {dashboard.upcomingExceptions.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-4 text-sm">
                  <span className="text-muted-foreground">{DATE_FMT.format(new Date(e.date))}</span>
                  <span className="flex-1">
                    {KIND_LABEL[e.kind] ?? e.kind}
                    {e.classroomName ? ` · ${e.classroomName}` : " · ทั้งโรงเรียน"}
                    {e.subjectName ? ` · ${e.subjectName}` : ""}
                  </span>
                  {e.note && <span className="text-muted-foreground">{e.note}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  tone: keyof typeof TONES;
}) {
  return (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-border">
      <div className="flex items-center gap-4">
        <div className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", TONES[tone].chip)}>
          <Icon className="size-5" />
        </div>
        <div>
          <p className="font-heading text-2xl font-semibold leading-none">{value}</p>
          <p className="mt-1 text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}
