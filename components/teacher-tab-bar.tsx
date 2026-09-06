"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, BookOpen, CalendarDays, CalendarOff, ClipboardPenLine, Gift } from "lucide-react";
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

// iOS bottom tab bar: fixed, translucent/blurred, icon stacked above label.
// Replaces the old horizontal top nav (components/teacher-nav.tsx) with the
// same destinations and active-route logic on phones.
export function TeacherTabBar({ pendingRedemptionCount = 0 }: { pendingRedemptionCount?: number }) {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-card/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden print:hidden">
      <div className="mx-auto flex max-w-2xl items-stretch justify-between px-1">
        {LINKS.map((link) => {
          const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium transition-colors active:scale-95",
                isActive ? "text-primary" : "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  isActive && "bg-primary/12",
                )}
              >
                <link.icon className="size-5.5" strokeWidth={isActive ? 2.25 : 2} />
              </span>
              <span className="leading-none">{link.label}</span>
              {link.href === "/teacher/rewards" && pendingRedemptionCount > 0 && (
                <span
                  aria-label={`มี ${pendingRedemptionCount} รายการรอดำเนินการ`}
                  className="absolute top-0.5 right-1/2 flex size-4 translate-x-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white"
                >
                  {pendingRedemptionCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
