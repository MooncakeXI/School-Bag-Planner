"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, BookOpen, CalendarDays, CalendarOff, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; icon: typeof LayoutDashboard; exact?: boolean }[] = [
  { href: "/teacher", label: "ภาพรวม", icon: LayoutDashboard, exact: true },
  { href: "/teacher/classrooms", label: "ห้องเรียน", icon: Users },
  { href: "/teacher/subjects", label: "วิชา", icon: BookOpen },
  { href: "/teacher/timetable", label: "ตารางเรียน", icon: CalendarDays },
  { href: "/teacher/exceptions", label: "วันหยุด/สลับคาบ", icon: CalendarOff },
  { href: "/teacher/rewards", label: "รางวัล", icon: Gift },
];

export function TeacherNav({ pendingRedemptionCount = 0 }: { pendingRedemptionCount?: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1.5 overflow-x-auto">
      {LINKS.map((link) => {
        const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <link.icon className="size-4" />
            {link.label}
            {link.href === "/teacher/rewards" && pendingRedemptionCount > 0 && (
              <span className="flex size-5 items-center justify-center rounded-full bg-warning-foreground text-[11px] font-bold text-warning">
                {pendingRedemptionCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
