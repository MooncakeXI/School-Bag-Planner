import "dotenv/config";
import { prisma } from "../lib/prisma";
import { sendEveningReminders, sendHomeworkDeadlineReminders } from "../lib/push";

// Manual/local trigger for the same code path app/api/cron/reminders/route.ts
// calls on a schedule — for testing the evening and homework reminders
// without waiting for 18:30/20:00 or standing up an external scheduler.
async function main() {
  const [evening, homework] = await Promise.all([sendEveningReminders(), sendHomeworkDeadlineReminders()]);
  console.log({ evening, homework });
}

main().finally(() => prisma.$disconnect());
