import { prisma } from "./prisma";
import { schoolDateToUtcMidnight, schoolToday } from "./time";

// Per-school anti-cheat/points tuning (CLAUDE.md "Anti-cheat"), columns on
// School — see prisma/schema.prisma's comment there for defaults/reasoning.
export type SchoolSettings = {
  morningWindowStartMinute: number;
  morningWindowEndMinute: number;
  sessionTtlMinutes: number;
  pointsPerCompletion: number;
};

const SETTINGS_SELECT = {
  morningWindowStartMinute: true,
  morningWindowEndMinute: true,
  sessionTtlMinutes: true,
  pointsPerCompletion: true,
} as const;

// Same values as the School columns' own DB defaults — used only when a
// student has no active enrollment to resolve a school through at all, so
// lookups degrade gracefully (mirrors lib/required-items.ts's "no
// enrollment -> empty result") instead of throwing.
const FALLBACK_SETTINGS: SchoolSettings = {
  morningWindowStartMinute: 300, // 05:00
  morningWindowEndMinute: 450, // 07:30
  sessionTtlMinutes: 20,
  pointsPerCompletion: 20,
};

export async function schoolSettingsForStudent(studentId: string): Promise<SchoolSettings> {
  const today = schoolDateToUtcMidnight(schoolToday());
  const enrollment = await prisma.enrollment.findFirst({
    where: { studentId, OR: [{ endDate: null }, { endDate: { gte: today } }] },
    orderBy: { startDate: "desc" },
    select: { classroom: { select: { school: { select: SETTINGS_SELECT } } } },
  });
  return enrollment?.classroom.school ?? FALLBACK_SETTINGS;
}
