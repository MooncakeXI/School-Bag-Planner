import { prisma } from "@/lib/prisma";

const TABLES = [
  "push_subscriptions",
  "redemptions",
  "rewards",
  "point_ledger",
  "packing_checks",
  "packing_sessions",
  "qr_codes",
  "schedule_exceptions",
  "timetable_slots",
  "item_copies",
  "subject_items",
  "subjects",
  "teaching_assignments",
  "teachers",
  "guardianships",
  "parents",
  "enrollments",
  "students",
  "classrooms",
  "schools",
  "sessions",
  "accounts",
  "verification_tokens",
  "users",
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
}
