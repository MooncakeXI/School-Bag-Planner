import { ClipboardPenLine, Clock3, Send } from "lucide-react";
import { requireActor } from "@/lib/session";
import { currentHomeworkForTeacher, formatHomeworkDeadline, homeworkTargetsForTeacher } from "@/lib/homework";
import { schoolNow } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createHomeworkAction } from "./actions";

export default async function TeacherHomeworkPage() {
  const actor = await requireActor();
  const [targets, homework] = await Promise.all([homeworkTargetsForTeacher(actor), currentHomeworkForTeacher(actor)]);
  const tomorrow = schoolNow().plus({ days: 1 }).toFormat("yyyy-LL-dd");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <PageHeader title="การบ้าน" subtitle="โพสต์งานและกำหนดส่งให้นักเรียนในแต่ละวิชา" />

      {targets.length === 0 ? (
        <div className="rounded-2xl bg-muted px-5 py-8 text-center text-sm text-muted-foreground">
          ยังไม่มีวิชาหรือห้องเรียนที่คุณสามารถโพสต์การบ้านได้
        </div>
      ) : (
        <form action={createHomeworkAction} className="flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ClipboardPenLine className="size-4 text-primary" />
            โพสต์การบ้านใหม่
          </div>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            ห้องเรียนและวิชา
            <select name="target" className="h-10 rounded-xl border border-input bg-background px-3 text-sm" defaultValue={`${targets[0].classroomId}|${targets[0].subjectId}`}>
              {targets.map((target) => (
                <option key={`${target.classroomId}-${target.subjectId}`} value={`${target.classroomId}|${target.subjectId}`}>
                  {target.classroomName} · {target.subjectName}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium">
            รายละเอียดการบ้าน
            <textarea
              name="description"
              required
              maxLength={2000}
              rows={4}
              placeholder="เช่น ทำแบบฝึกหัดหน้า 12–13 และนำมาส่ง"
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              วันที่กำหนดส่ง
              <Input name="deadlineDate" type="date" defaultValue={tomorrow} required className="h-10" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              เวลากำหนดส่ง
              <Input name="deadlineTime" type="time" defaultValue="23:59" required className="h-10" />
            </label>
          </div>

          <Button type="submit" className="min-h-11 self-end rounded-xl">
            <Send className="size-4" />
            โพสต์การบ้าน
          </Button>
        </form>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">การบ้านที่ยังไม่ถึงกำหนดส่ง</h2>
        {homework.length === 0 ? (
          <div className="rounded-2xl bg-muted px-5 py-8 text-center text-sm text-muted-foreground">ยังไม่มีการบ้านที่กำลังเปิดอยู่</div>
        ) : (
          <ul className="flex flex-col gap-3">
            {homework.map((item) => (
              <li key={item.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{item.subject.name}</p>
                  <span className="text-xs font-medium text-muted-foreground">{item.classroom.name}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.description}</p>
                <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-warning">
                  <Clock3 className="size-4" />
                  ส่งภายใน {formatHomeworkDeadline(item.deadlineAt)} น.
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
