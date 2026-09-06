import { NextResponse } from "next/server";
import { sendEveningReminders, sendHomeworkDeadlineReminders } from "@/lib/push";

// Invoked by an external scheduler (OS cron / hosting-platform cron) at
// 18:30 and 20:00 Asia/Bangkok — this repo has no deployment target
// configured yet, so the schedule itself lives outside this codebase. Those
// calls also deliver any homework that has entered its 24-hour deadline
// notice window (deduplicated per student/homework). See
// scripts/send-reminders-once.ts for a manual/local trigger of the same path.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [evening, homework] = await Promise.all([sendEveningReminders(), sendHomeworkDeadlineReminders()]);
  // A non-2xx only when nothing at all could be sent — i.e. every attempted
  // delivery failed, not merely "some did." Zero sent with zero failed is a
  // healthy run (nobody had anything left to pack), not an error.
  const sent = evening.sent + homework.sent;
  const failed = evening.failed + homework.failed;
  const status = sent === 0 && failed > 0 ? 502 : 200;
  return NextResponse.json({ evening, homework }, { status });
}
