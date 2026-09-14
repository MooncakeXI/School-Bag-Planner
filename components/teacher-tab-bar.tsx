"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, BookOpen, CalendarDays, CalendarOff, ClipboardPenLine, Gift, MoreHorizontal } from "lucide-react";
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
  const primaryLinks = LINKS.filter((link) =>
    ["/teacher", "/teacher/classrooms", "/teacher/timetable", "/teacher/homework"].includes(link.href),
  );
  const moreLinks = LINKS.filter((link) => !primaryLinks.includes(link));
  const moreIsActive = moreLinks.some((link) => pathname.startsWith(link.href));

  return (
    <nav aria-label="เมนูคุณครู" className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-card/95 px-2 pt-2 pb-[max(theme(spacing.2),env(safe-area-inset-bottom))] shadow-[0_-8px_30px_rgba(58,45,36,0.08)] backdrop-blur lg:hidden print:hidden">
      <div className="mx-auto flex max-w-lg items-stretch gap-1">
        {primaryLinks.map((link) => {
          const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-2xl px-1 text-xs font-semibold transition-colors active:scale-95",
                isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-muted",
              )}
            >
              <link.icon className="size-6" strokeWidth={isActive ? 2.5 : 2.1} aria-hidden />
              <span className="leading-none">{link.label}</span>
              {link.href === "/teacher/rewards" && pendingRedemptionCount > 0 && (
                <span
                  aria-label={`มี ${pendingRedemptionCount} รายการรอดำเนินการ`}
                  className="absolute top-1 right-1/2 flex size-4 translate-x-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white ring-2 ring-card"
                >
                  {pendingRedemptionCount}
                </span>
              )}
            </Link>
          );
        })}
        <details className="group relative flex-1">
          <summary
            className={cn(
              "flex min-h-16 cursor-pointer list-none flex-col items-center justify-center gap-1 rounded-2xl px-1 text-xs font-semibold transition-colors active:scale-95 [&::-webkit-details-marker]:hidden",
              moreIsActive ? "bg-primary text-primary-foreground" : "text-muted-foreground active:bg-muted",
            )}
          >
            <MoreHorizontal className="size-6" aria-hidden />
            <span className="leading-none">เพิ่มเติม</span>
            {pendingRedemptionCount > 0 && (
              <span
                aria-label={`มี ${pendingRedemptionCount} รายการรอดำเนินการ`}
                className="absolute top-1 right-1/2 flex size-4 translate-x-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-white ring-2 ring-card"
              >
                {pendingRedemptionCount}
              </span>
            )}
          </summary>
          <div className="absolute right-0 bottom-[calc(100%+0.75rem)] w-56 overflow-hidden rounded-3xl border border-border bg-card p-2 shadow-2xl">
            {moreLinks.map((link) => {
              const isActive = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-2xl px-3 text-base font-semibold",
                    isActive ? "bg-primary text-primary-foreground" : "text-foreground active:bg-muted",
                  )}
                >
                  <link.icon className="size-5" aria-hidden />
                  {link.label}
                  {link.href === "/teacher/rewards" && pendingRedemptionCount > 0 && (
                    <span className="ml-auto rounded-full bg-destructive px-2 py-0.5 text-xs font-bold text-white">
                      {pendingRedemptionCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </details>
      </div>
    </nav>
  );
}
