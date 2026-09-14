import {
  BookOpen,
  Calculator,
  Compass,
  Dumbbell,
  FlaskConical,
  Globe,
  Hammer,
  HeartPulse,
  Languages,
  Landmark,
  Monitor,
  Music,
  Palette,
  type LucideIcon,
} from "lucide-react";
import { createElement, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Fixed palette lifted from the design reference (math/thai/sci/pe/art).
// Subjects are assigned a color deterministically by name so the same
// subject always renders the same chip color without hardcoding school-
// specific subject names.
const PALETTE = [
  { bg: "#EDE7FF", fg: "#5B3FA8" },
  { bg: "#FBEAE1", fg: "#9C3F1F" },
  { bg: "#E4F1EA", fg: "#2E7D5B" },
  { bg: "#E2F0F6", fg: "#1B6480" },
  { bg: "#FDF0D5", fg: "#8A5E06" },
];

function colorFor(subjectName: string) {
  let hash = 0;
  for (let i = 0; i < subjectName.length; i++) hash = (hash * 31 + subjectName.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function subjectIcon(Icon: LucideIcon) {
  return createElement(Icon, { className: "size-1/2" });
}

const SUBJECT_ICONS: [string, ReactNode][] = [
  ["คณิต", subjectIcon(Calculator)],
  ["วิทย", subjectIcon(FlaskConical)],
  ["ภาษาไทย", subjectIcon(BookOpen)],
  ["อังกฤษ", subjectIcon(Languages)],
  ["สังคม", subjectIcon(Globe)],
  ["ประวัติ", subjectIcon(Landmark)],
  ["ศาสนา", subjectIcon(Landmark)],
  ["พละ", subjectIcon(Dumbbell)],
  ["สุขศึกษา", subjectIcon(HeartPulse)],
  ["ศิลป", subjectIcon(Palette)],
  ["ดนตรี", subjectIcon(Music)],
  ["คอม", subjectIcon(Monitor)],
  ["เทคโนโลยี", subjectIcon(Monitor)],
  ["การงาน", subjectIcon(Hammer)],
  ["แนะแนว", subjectIcon(Compass)],
];

export function SubjectChip({ subjectName, className, showIcon = false }: { subjectName: string; className?: string; showIcon?: boolean }) {
  const match = showIcon ? SUBJECT_ICONS.find(([keyword]) => subjectName.includes(keyword)) : undefined;
  const { bg, fg } = colorFor(match?.[0] ?? subjectName);
  const icon = match?.[1];
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold leading-tight",
        className,
      )}
      style={{ background: bg, color: fg }}
      aria-hidden
    >
      {icon ?? subjectName.slice(0, 2)}
    </span>
  );
}
