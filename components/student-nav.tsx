"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, CalendarDays, Gift } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/student/tomorrow", label: "หน้าแรก", icon: Home },
  { href: "/student/week", label: "ตาราง", icon: CalendarDays },
  { href: "/student/rewards", label: "รางวัล", icon: Gift },
] as const;

// The reference's 3-tab bottom bar — replaces the old พรุ่งนี้/สัปดาห์นี้
// pill toggle now that "รางวัล" is a real route, avoiding two overlapping
// navigation layers.
export function StudentNav() {
  const pathname = usePathname();

  return (
    <nav className="sticky bottom-0 z-40 grid grid-cols-3 border-t border-border bg-card/95 px-2 pb-[max(theme(spacing.2),env(safe-area-inset-bottom))] pt-2 backdrop-blur">
      {LINKS.map((link) => {
        const isActive = pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl py-1.5 text-xs font-medium",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <link.icon className="size-6" strokeWidth={isActive ? 2.4 : 2} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
