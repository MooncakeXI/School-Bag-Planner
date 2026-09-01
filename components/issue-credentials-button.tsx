"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { issueStudentCredentialsAction } from "@/app/teacher/classrooms/[id]/actions";

export function IssueCredentialsButton({ studentId, hasCode }: { studentId: string; hasCode: boolean }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ studentCode: string; password: string } | null>(null);

  const issue = () => {
    startTransition(async () => {
      const r = await issueStudentCredentialsAction(studentId);
      setResult(r);
    });
  };

  if (result) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-accent px-3 py-1.5 text-xs text-accent-foreground">
        <span>
          รหัสนักเรียน <b className="font-mono">{result.studentCode}</b> · รหัสผ่าน{" "}
          <b className="font-mono">{result.password}</b>
        </span>
        <span className="opacity-70">(บันทึกไว้ตอนนี้ จะไม่แสดงซ้ำ)</span>
      </div>
    );
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={issue} disabled={pending}>
      <KeyRound className="size-3.5" />
      {hasCode ? "รีเซ็ตรหัสผ่าน" : "สร้างรหัสเข้าใช้งาน"}
    </Button>
  );
}
