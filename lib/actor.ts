import { prisma } from "./prisma";

/**
 * The derived roles for a logged-in user. There is deliberately no `role`
 * column on User (CLAUDE.md: access is relationship-based, not
 * role-based) — a person's roles are whichever profile rows point at
 * their user id, and more than one can be set at once (e.g. a teacher
 * who is also a parent).
 */
export type Actor = {
  userId: string;
  teacherId: string | null;
  parentId: string | null;
  studentId: string | null;
};

export async function resolveActor(userId: string): Promise<Actor> {
  const [teacher, parent, student] = await Promise.all([
    prisma.teacher.findUnique({ where: { userId }, select: { id: true } }),
    prisma.parent.findUnique({ where: { userId }, select: { id: true } }),
    prisma.student.findUnique({ where: { userId }, select: { id: true } }),
  ]);

  return {
    userId,
    teacherId: teacher?.id ?? null,
    parentId: parent?.id ?? null,
    studentId: student?.id ?? null,
  };
}
