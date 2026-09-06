import { Users, GraduationCap, ClipboardCheck, School, CalendarOff, Repeat, PencilLine, Ban } from "lucide-react";
import { requireActor } from "@/lib/session";
import { teacherDashboard } from "@/lib/dashboard";
import { cn } from "@/lib/utils";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/page-header";
import { ListGroup, ListRow } from "@/components/ios-list";
import { RowIcon, type RowIconTone } from "@/components/row-icon";

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

const KIND_ICON: Record<string, { icon: typeof CalendarOff; tone: RowIconTone }> = {
  HOLIDAY: { icon: CalendarOff, tone: "success" },
  PERIOD_SWAP: { icon: Repeat, tone: "info" },
  EXAM: { icon: PencilLine, tone: "warning" },
  CANCELLED_PERIOD: { icon: Ban, tone: "neutral" },
};

const DATE_FMT = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short" });

export default async function TeacherDashboardPage() {
  const actor = await requireActor();
  const dashboard = await teacherDashboard(actor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ภาพรวม" />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={Users} label="ห้องเรียนที่สอน" value={dashboard.classroomCount} tone="neutral" />
        <StatCard icon={GraduationCap} label="นักเรียนทั้งหมด" value={dashboard.studentCount} tone="success" />
        <StatCard icon={ClipboardCheck} label="กำลังตรวจ (GRADING)" value={dashboard.gradingCount} tone="warning" />
      </div>

      <ListGroup label="วันนี้สอนอะไรบ้าง">
        {dashboard.todayByClassroom.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">ยังไม่มีห้องเรียนที่คุณสอน</p>
        ) : (
          dashboard.todayByClassroom.map((c) => (
            <ListRow
              key={c.classroomId}
              href={`/teacher/classrooms/${c.classroomId}`}
              leading={<RowIcon icon={School} tone="primary" />}
              trailing={
                c.isHoliday ? (
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
                )
              }
            >
              <span className="font-medium">{c.classroomName}</span>
            </ListRow>
          ))
        )}
      </ListGroup>

      <ListGroup label="วันหยุด/สลับคาบที่จะถึง (14 วันข้างหน้า)">
        {dashboard.upcomingExceptions.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">ไม่มีรายการในช่วงนี้</p>
        ) : (
          dashboard.upcomingExceptions.map((e) => {
            const kindIcon = KIND_ICON[e.kind];
            return (
              <ListRow
                key={e.id}
                chevron={false}
                leading={kindIcon && <RowIcon icon={kindIcon.icon} tone={kindIcon.tone} />}
                trailing={e.note && <span className="text-xs text-muted-foreground">{e.note}</span>}
              >
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{DATE_FMT.format(new Date(e.date))}</span>
                  <span>
                    {KIND_LABEL[e.kind] ?? e.kind}
                    {e.classroomName ? ` · ${e.classroomName}` : " · ทั้งโรงเรียน"}
                    {e.subjectName ? ` · ${e.subjectName}` : ""}
                  </span>
                </div>
              </ListRow>
            );
          })
        )}
      </ListGroup>
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
