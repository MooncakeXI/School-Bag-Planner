"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
import { StudentAvatar, shortStudentName } from "@/components/student-avatar";
import { cn } from "@/lib/utils";

type TabId = "account" | "guardians" | "points" | "items";

export function StudentDetailDialog({
  name,
  meta,
  actions,
  account,
  guardians,
  points,
  items,
}: {
  name: string;
  meta: string;
  actions?: ReactNode;
  account: ReactNode;
  guardians: ReactNode;
  points?: ReactNode;
  items: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [activeTab, setActiveTab] = useState<TabId>("account");
  const tabs = [
    { id: "account" as const, label: "บัญชี", content: account },
    { id: "guardians" as const, label: "ผู้ปกครอง", content: guardians },
    ...(points ? [{ id: "points" as const, label: "แต้ม", content: points }] : []),
    { id: "items" as const, label: "อุปกรณ์", content: items },
  ];
  const activeContent = tabs.find((tab) => tab.id === activeTab)?.content ?? account;

  return (
    <>
      <button
        type="button"
        className="flex min-h-20 w-full cursor-pointer items-center justify-between gap-3 rounded-3xl bg-card px-5 py-3 text-left ring-1 ring-border shadow-[0_8px_24px_-8px_rgba(0,0,0,0.12)] transition-colors active:bg-muted"
        onClick={() => dialogRef.current?.showModal()}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <StudentAvatar name={name} className="size-11" />
          <span className="min-w-0">
            <span className="block truncate font-heading text-lg font-semibold">{shortStudentName(name)}</span>
            <span className="block text-sm text-muted-foreground">{meta}</span>
          </span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-background p-0 text-foreground backdrop:bg-foreground/35 lg:m-auto lg:h-[min(88dvh,56rem)] lg:max-w-3xl lg:rounded-3xl"
      >
        <div className="flex min-h-full flex-col">
          <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
            <StudentAvatar name={name} className="size-11" />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate font-heading text-xl font-semibold">
                {shortStudentName(name)}
              </h2>
              <p className="text-sm text-muted-foreground">{meta}</p>
            </div>
            <button
              type="button"
              aria-label="ปิดรายละเอียดนักเรียน"
              className="flex size-11 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => dialogRef.current?.close()}
            >
              <X className="size-5" aria-hidden />
            </button>
          </header>

          <div className="flex flex-1 flex-col gap-4 p-4 sm:p-5">
            {actions}
            <div role="tablist" aria-label="หมวดข้อมูลนักเรียน" className="flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={cn(
                    "min-h-11 flex-1 cursor-pointer rounded-xl px-3 text-sm font-semibold whitespace-nowrap transition-colors",
                    activeTab === tab.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                  )}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="min-w-0 flex-1">
              {activeContent}
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}
