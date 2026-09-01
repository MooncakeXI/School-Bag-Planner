import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { STUDENT_CODE_LENGTH, STUDENT_PASSWORD_LENGTH } from "./student-code";

// Most students have no Gmail of their own — a teacher issues a short
// numeric code + PIN instead (lib/roster.ts's issueStudentCredentials).
// Logging in with them does NOT go through Auth.js's Credentials provider:
// that provider is JWT-only by design (no OAuth Account row to persist),
// which would silently break CLAUDE.md's "database sessions, not JWT"
// requirement for the whole app. Instead this creates a real row in the
// same `sessions` table Auth.js's own adapter uses, so auth()/requireActor()
// resolve it exactly like a Google-authenticated session — see
// app/login/student-actions.ts, which sets the matching cookie.

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
export const STUDENT_SESSION_DAYS = 30;

function randomDigits(length: number): string {
  return Array.from({ length }, () => randomInt(0, 10)).join("");
}

export async function generateUniqueStudentCode(): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = randomDigits(STUDENT_CODE_LENGTH);
    const existing = await prisma.student.findUnique({ where: { studentCode: code }, select: { id: true } });
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique student code");
}

export function generatePassword(): string {
  return randomDigits(STUDENT_PASSWORD_LENGTH);
}

type LoginResult =
  | { ok: true; sessionToken: string; expires: Date }
  | { ok: false; error: string };

export async function verifyStudentLogin(studentCode: string, password: string): Promise<LoginResult> {
  const student = await prisma.student.findUnique({ where: { studentCode } });
  const genericError = "รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง";

  if (!student || !student.passwordHash) return { ok: false, error: genericError };

  if (student.lockedUntil && student.lockedUntil > new Date()) {
    return { ok: false, error: "ลองผิดหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง" };
  }

  const matches = await bcrypt.compare(password, student.passwordHash);
  if (!matches) {
    const attempts = student.failedLoginAttempts + 1;
    const lockedOut = attempts >= LOCKOUT_THRESHOLD;
    await prisma.student.update({
      where: { id: student.id },
      data: {
        failedLoginAttempts: lockedOut ? 0 : attempts,
        lockedUntil: lockedOut ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null,
      },
    });
    return { ok: false, error: genericError };
  }

  let userId = student.userId;
  if (!userId) {
    const user = await prisma.user.create({ data: { name: student.name } });
    userId = user.id;
  }

  await prisma.student.update({
    where: { id: student.id },
    data: { userId, failedLoginAttempts: 0, lockedUntil: null },
  });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + STUDENT_SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { sessionToken, userId, expires } });

  return { ok: true, sessionToken, expires };
}

/** Matches Auth.js v5's own database-session cookie naming exactly, so auth() reads this session back. */
export function studentSessionCookie(secure: boolean) {
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}
