import { NextResponse } from "next/server";
import { sendEveningReminders } from "@/lib/push";

// Invoked by an external scheduler (OS cron / hosting-platform cron) at
// 18:30 and 20:00 Asia/Bangkok — this repo has no deployment target
// configured yet, so the schedule itself lives outside this codebase. See
// scripts/send-reminders-once.ts for a manual/local trigger of the same
// code path.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await sendEveningReminders();
  return NextResponse.json(result);
}
