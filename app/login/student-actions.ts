"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyStudentLogin, studentSessionCookie } from "@/lib/student-auth";

export type StudentLoginState = { error: string | null };

export async function studentLoginAction(_prev: StudentLoginState, formData: FormData): Promise<StudentLoginState> {
  const studentCode = String(formData.get("studentCode") ?? "").trim();
  const password = String(formData.get("password") ?? "").trim();
  if (!studentCode || !password) return { error: "กรุณากรอกรหัสนักเรียนและรหัสผ่าน" };

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
