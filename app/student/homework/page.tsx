import { Bell, ClipboardList, Clock3 } from "lucide-react";
import { requireActor } from "@/lib/session";
import { currentHomeworkForStudent, formatHomeworkDeadline } from "@/lib/homework";
import { NotificationOptIn } from "@/components/notification-opt-in";

export default async function StudentHomeworkPage() {
  const actor = await requireActor();
  const homework = await currentHomeworkForStudent(actor.studentId!);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-col gap-5 pt-4">
      <div>
        <h1 className="font-heading text-[28px] font-bold tracking-tight">การบ้านของฉัน</h1>
        <p className="mt-1 text-sm text-muted-foreground">งานที่ยังไม่ถึงกำหนดส่ง</p>
      </div>

      {homework.length === 0 ? (
        <div className="rounded-3xl bg-muted px-6 py-12 text-center">
          <ClipboardList className="mx-auto size-8 text-muted-foreground" />
          <p className="mt-3 font-semibold">ยังไม่มีการบ้าน</p>
          <p className="mt-1 text-sm text-muted-foreground">ถ้าครูโพสต์งานใหม่ จะแสดงที่นี่</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {homework.map((item) => (
            <li key={item.id} className="rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
              <p className="font-heading text-lg font-semibold">{item.subject.name}</p>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{item.description}</p>
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-warning-foreground/10 px-3 py-2.5 text-sm font-semibold text-warning">
                <Clock3 className="size-4 shrink-0" />
                <span>ส่งภายใน {formatHomeworkDeadline(item.deadlineAt)} น.</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl bg-accent p-4 text-sm text-accent-foreground">
        <div className="flex items-center gap-2 font-semibold">
          <Bell className="size-4" />
          เตือนก่อนถึงกำหนดส่ง
        </div>
        <p className="mt-1 text-[13px] leading-relaxed opacity-80">เปิดการแจ้งเตือนเพื่อให้โทรศัพท์เตือนเมื่อเหลือเวลาไม่เกิน 24 ชั่วโมง</p>
        <div className="mt-3">
          <NotificationOptIn />
        </div>
      </div>
    </main>
  );
}
