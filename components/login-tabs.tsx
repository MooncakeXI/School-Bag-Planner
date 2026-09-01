"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function LoginTabs({ teacherParent, student }: { teacherParent: ReactNode; student: ReactNode }) {
  const [tab, setTab] = useState<"teacherParent" | "student">("teacherParent");

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="mx-auto flex w-full gap-1 rounded-2xl bg-muted p-1.5">
        <button
          type="button"
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
          onClick={() => setTab("student")}
          className={cn(
            "flex-1 rounded-xl py-2 text-sm font-semibold transition-colors",
            tab === "student" ? "bg-foreground text-background" : "text-muted-foreground",
          )}
        >
          นักเรียน
        </button>
      </div>
      {tab === "teacherParent" ? teacherParent : student}
    </div>
  );
}
