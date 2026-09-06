"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LoginTabs({ teacherParent, student }: { teacherParent: ReactNode; student: ReactNode }) {
  const [tab, setTab] = useState<"teacherParent" | "student">("teacherParent");

  return (
    <div className="flex w-full flex-col gap-5">
      <div role="tablist" aria-label="เลือกวิธีเข้าสู่ระบบ" className="mx-auto flex w-full gap-1 rounded-2xl bg-muted p-1.5">
        <button
          type="button"
          role="tab"
          id="login-tab-teacherParent"
          aria-selected={tab === "teacherParent"}
          aria-controls="login-panel"
          onClick={() => setTab("teacherParent")}
          className={cn(
            "flex-1 rounded-xl py-2 text-sm font-semibold transition-colors",
            tab === "teacherParent" ? "bg-foreground text-background" : "text-muted-foreground",
          )}
        >
          ครู / ผู้ปกครอง
        </button>
        <button
          type="button"
          role="tab"
          id="login-tab-student"
          aria-selected={tab === "student"}
          aria-controls="login-panel"
          onClick={() => setTab("student")}
          className={cn(
            "flex-1 rounded-xl py-2 text-sm font-semibold transition-colors",
            tab === "student" ? "bg-foreground text-background" : "text-muted-foreground",
          )}
        >
          นักเรียน
        </button>
      </div>
      <div id="login-panel" role="tabpanel" aria-labelledby={tab === "teacherParent" ? "login-tab-teacherParent" : "login-tab-student"}>
        {tab === "teacherParent" ? teacherParent : student}
      </div>
    </div>
  );
}
