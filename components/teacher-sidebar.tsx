"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, BookOpen, CalendarDays, CalendarOff, ClipboardPenLine, Gift, Backpack, CalendarCheck2, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { href: "/teacher", label: "ภาพรวม", icon: LayoutDashboard, exact: true },
  { href: "/teacher/classrooms", label: "ห้องเรียน", icon: Users },
  { href: "/teacher/subjects", label: "วิชา", icon: BookOpen },
  { href: "/teacher/timetable", label: "ตารางเรียน", icon: CalendarDays },
  { href: "/teacher/exceptions", label: "วันหยุด", icon: CalendarOff },
  { href: "/teacher/homework", label: "การบ้าน", icon: ClipboardPenLine },
  { href: "/teacher/rewards", label: "รางวัล", icon: Gift },
];

// One persistent sidebar — same top-level destinations, same order, same
// position, on every /teacher/* page, desktop only (phone/tablet keeps the
// bottom tab bar, components/teacher-tab-bar.tsx). Previously this swapped
// out entirely for a different "classroom-contextual" sidebar while inside
// a classroom's own pages, which left no way back to the other 5
// destinations except the browser back button — reversed on purpose (the
// user's own words: "sidebar should have only 1 format not changeable").
// Instead, viewing a specific classroom just expands a nested section
// directly under "ห้องเรียน" — the sidebar's own shape never changes, only
// this one section's contents.
export function TeacherSidebar({
  classrooms,
  pendingRedemptionCount = 0,
  signOutControl,
}: {
  classrooms: { id: string; name: string }[];
  pendingRedemptionCount?: number;
  signOutControl?: ReactNode;
}) {
  const pathname = usePathname();
  const classroomMatch = pathname.match(/^\/teacher\/classrooms\/([^/]+)/);
  const currentClassroom = classroomMatch ? classrooms.find((c) => c.id === classroomMatch[1]) : undefined;

  return (
    <nav className="hidden w-64 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-card p-4 text-foreground lg:flex">
      <div className="flex items-center gap-2.5 px-2 py-3 font-heading font-semibold">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Backpack className="size-5" aria-hidden />
        </span>
        จัดกระเป๋าไปโรงเรียน
      </div>
      {LINKS.map((link) => {
        const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        const isClassroomsLink = link.href === "/teacher/classrooms";
        return (
          <div key={link.href} className="flex flex-col gap-1">
            <Link
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-12 items-center gap-3 rounded-2xl px-3.5 text-base font-semibold transition-colors",
                isActive ? "bg-primary text-primary-foreground shadow-md shadow-primary/20" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <link.icon className="size-4.5" strokeWidth={isActive ? 2.25 : 2} />
              {link.label}
              {link.href === "/teacher/rewards" && pendingRedemptionCount > 0 && (
                <span
                  aria-label={`มี ${pendingRedemptionCount} รายการรอดำเนินการ`}
                  className="ml-auto flex size-5 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-white"
                >
                  {pendingRedemptionCount}
                </span>
              )}
            </Link>

            {isClassroomsLink && currentClassroom && (
              <ClassroomSubNav classroomId={currentClassroom.id} classroomName={currentClassroom.name} pathname={pathname} />
            )}
          </div>
        );
      })}
      {signOutControl && <div className="mt-auto border-t border-border pt-3">{signOutControl}</div>}
    </nav>
  );
}

function ClassroomSubNav({ classroomId, classroomName, pathname }: { classroomId: string; classroomName: string; pathname: string }) {
  const base = `/teacher/classrooms/${classroomId}`;
  const subLinks = [
    { href: `${base}/today`, label: "วันนี้", icon: CalendarCheck2 },
    { href: base, label: "รายชื่อนักเรียน", icon: Users },
    { href: `${base}/print-qr`, label: "สติกเกอร์ QR", icon: QrCode },
  ];

  return (
    <div className="ml-5 flex flex-col gap-1 border-l-2 border-border py-1 pl-3">
      <p className="truncate px-2 py-1 text-sm font-semibold text-muted-foreground">{classroomName}</p>
      {subLinks.map((link) => {
        const isActive = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-sm font-semibold transition-colors",
              isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <link.icon className="size-4" strokeWidth={isActive ? 2.25 : 2} />
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
