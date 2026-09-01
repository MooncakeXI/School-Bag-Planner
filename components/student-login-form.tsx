"use client";

import { useActionState } from "react";
import { studentLoginAction, type StudentLoginState } from "@/app/login/student-actions";
import { Button } from "@/components/ui/button";
import { STUDENT_CODE_LENGTH, STUDENT_PASSWORD_LENGTH } from "@/lib/student-code";

const initialState: StudentLoginState = { error: null };

// Numeric-only, big touch targets, no typing — CLAUDE.md's UX mandate for
// this exact audience. Most students have no Gmail, so this is a
// teacher-issued code + PIN instead of Google sign-in (see lib/student-auth.ts).
export function StudentLoginForm() {
  const [state, formAction, pending] = useActionState(studentLoginAction, initialState);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <div className="space-y-1.5">
        <label htmlFor="studentCode" className="text-sm font-medium text-muted-foreground">
          รหัสนักเรียน
        </label>
        <input
          id="studentCode"
          name="studentCode"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={STUDENT_CODE_LENGTH}
          autoComplete="off"
          required
          className="h-14 w-full rounded-2xl border border-input bg-background px-4 text-center font-heading text-2xl tracking-[0.3em] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium text-muted-foreground">
          รหัสผ่าน
        </label>
        <input
          id="password"
          name="password"
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={STUDENT_PASSWORD_LENGTH}
          autoComplete="off"
          required
          className="h-14 w-full rounded-2xl border border-input bg-background px-4 text-center font-heading text-2xl tracking-[0.3em] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>
      {state.error && <p className="text-center text-sm text-destructive">{state.error}</p>}
      <Button type="submit" size="lg" disabled={pending} className="h-[52px] w-full rounded-2xl text-base font-semibold">
        เข้าสู่ระบบ
      </Button>
    </form>
  );
}
