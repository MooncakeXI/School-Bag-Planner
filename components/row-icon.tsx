import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning-foreground text-warning",
  info: "bg-[#E2F0F6] text-[#1B6480]",
} as const;

export type RowIconTone = keyof typeof TONES;

// Small colored icon badge for a ListRow's `leading` slot (components/
// ios-list.tsx) — the iOS Settings.app convention of a tinted square icon
// ahead of each row label. Used to give otherwise-plain text lists (a
// classroom name, a reward, an upcoming exception) some visual identity
// instead of reading as a bare bullet list.
export function RowIcon({
  icon: Icon,
  tone = "neutral",
  className,
}: {
  icon: LucideIcon;
  tone?: RowIconTone;
  className?: string;
}) {
  return (
    <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONES[tone], className)}>
      <Icon className="size-4.5" />
    </div>
  );
}
