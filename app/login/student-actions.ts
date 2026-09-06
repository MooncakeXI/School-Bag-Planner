"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyStudentLogin, studentSessionCookie } from "@/lib/student-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export type StudentLoginState = { error: string | null };

// Independent of lib/student-auth.ts's per-student backoff: that throttles
// repeated wrong guesses against *one* account, but does nothing to slow
// down trying many *different* 6-digit codes to find one that exists. This
// throttles by client IP instead, regardless of which (or how many
// different) codes it tries — see lib/rate-limit.ts.
const IP_LOGIN_LIMIT = { max: 10, windowMs: 60_000 };

function clientIp(headerList: Awaited<ReturnType<typeof headers>>): string {
  // Trusts X-Forwarded-For as set by the deployment's own proxy/CDN — this
  // is a coarse anti-enumeration throttle, not an identity check, so a
  // spoofed header at worst costs an attacker nothing they didn't already
  // have (no rate limit at all looks the same as a bypassed one).
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headerList.get("x-real-ip") ?? "unknown";
}

export async function studentLoginAction(_prev: StudentLoginState, formData: FormData): Promise<StudentLoginState> {
  const studentCode = String(formData.get("studentCode") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  if (!studentCode || !password) return { error: "กรุณากรอกรหัสนักเรียนและรหัสผ่าน" };

  const ip = clientIp(await headers());
  const rateLimit = checkRateLimit(`student-login:${ip}`, IP_LOGIN_LIMIT);
  if (!rateLimit.allowed) {
    return { error: `เข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ใน ${rateLimit.retryAfterSeconds} วินาที` };
  }

  const result = await verifyStudentLogin(studentCode, password);
  if (!result.ok) return { error: result.error };

  // Not an Auth.js Credentials-provider sign-in — see lib/student-auth.ts's
  // comment. This writes to the exact same `sessions` table/cookie Auth.js's
  // own database-session strategy reads, so auth() picks it up transparently.
  const secure = process.env.NODE_ENV === "production";
  const cookieStore = await cookies();
  cookieStore.set(studentSessionCookie(secure), result.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    expires: result.expires,
  });

  redirect("/");
}
