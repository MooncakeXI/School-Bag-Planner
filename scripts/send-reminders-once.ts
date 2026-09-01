import "dotenv/config";
import { prisma } from "../lib/prisma";
import { sendEveningReminders } from "../lib/push";

// Manual/local trigger for the same code path app/api/cron/reminders/route.ts
// calls on a schedule — for testing the evening reminder without waiting
// for 18:30/20:00 or standing up an external scheduler.
async function main() {
  const result = await sendEveningReminders();
  console.log(result);
}

main().finally(() => prisma.$disconnect());
