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

// Exponential backoff on wrong-password attempts, not a hard lock. A hard
// lock (the earlier design: 5 wrong attempts -> 15-minute lock) protects
// the wrong party here: student codes are 6 digits and children share them
// with each other as a matter of course, so any classmate who knows the
// code can lock the real owner out for 15 minutes just by mashing the PIN
// field — a denial-of-service tool aimed at the legitimate user, not the
// attacker. Backoff instead makes each successive wrong guess against one
// account slower (1s, 2s, 4s, 8s, ... capped at BACKOFF_MAX_SECONDS), while
// a *correct* password always succeeds immediately regardless of any
// pending cooldown — see verifyStudentLogin. The backoff level decays back
// to zero after a quiet period (BACKOFF_DECAY_MINUTES) so a stale run of
// failures from days ago doesn't linger. Separately, code enumeration
// across *different* accounts is throttled per-IP, not per-account — see
// lib/rate-limit.ts, wired in at app/login/student-actions.ts.
const BACKOFF_MAX_SECONDS = 60;
const BACKOFF_DECAY_MINUTES = 10;
export const STUDENT_SESSION_DAYS = 30;

/** attempts=1 -> 1s, 2 -> 2s, 3 -> 4s, 4 -> 8s, ..., capped at BACKOFF_MAX_SECONDS. */
function backoffSeconds(attempts: number): number {
  return Math.min(BACKOFF_MAX_SECONDS, 2 ** (attempts - 1));
}

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

  // Never reveals whether the code exists — same generic message as a
  // wrong password against a real account (see below).
  if (!student || !student.passwordHash) return { ok: false, error: genericError };

  const now = new Date();

  // bcrypt runs unconditionally, even inside an active cooldown — a
  // correct password always succeeds immediately with no residual lock.
  // The cooldown only ever throttles *wrong* guesses.
  const matches = await bcrypt.compare(password, student.passwordHash);

  if (!matches) {
    // Still inside a cooldown a previous wrong attempt set: don't advance
    // the backoff level for hammering during the wait (that would let an
    // attacker "pay" for a slot with a wrong guess and then retry sooner
    // by spamming), just report the time actually remaining.
    if (student.nextLoginAttemptAt && student.nextLoginAttemptAt > now) {
      const retryAfterSeconds = Math.ceil((student.nextLoginAttemptAt.getTime() - now.getTime()) / 1000);
      return { ok: false, error: `${genericError} ลองใหม่ใน ${retryAfterSeconds} วินาที` };
    }

    // A fresh wrong attempt. Decay back to 0 first if it's been quiet for
    // a while — approximated from nextLoginAttemptAt (the end of the last
    // cooldown) rather than a separate "last failed at" column, so this
    // needs no extra field; the error is at most one backoff interval
    // (<= BACKOFF_MAX_SECONDS), negligible against a multi-minute decay
    // window.
    const quiet =
      student.nextLoginAttemptAt != null &&
      now.getTime() - student.nextLoginAttemptAt.getTime() > BACKOFF_DECAY_MINUTES * 60 * 1000;
    const attempts = (quiet ? 0 : student.failedLoginAttempts) + 1;
    const delaySeconds = backoffSeconds(attempts);

    await prisma.student.update({
      where: { id: student.id },
      data: { failedLoginAttempts: attempts, nextLoginAttemptAt: new Date(now.getTime() + delaySeconds * 1000) },
    });
    return { ok: false, error: `${genericError} ลองใหม่ใน ${delaySeconds} วินาที` };
  }

  let userId = student.userId;
  if (!userId) {
    const user = await prisma.user.create({ data: { name: student.name } });
    userId = user.id;
  }

  await prisma.student.update({
    where: { id: student.id },
    data: { userId, failedLoginAttempts: 0, nextLoginAttemptAt: null },
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
