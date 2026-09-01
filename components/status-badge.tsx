import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning-foreground text-warning",
  danger: "bg-accent text-accent-foreground",
  info: "bg-[#E2F0F6] text-[#1B6480]",
} as const;

export function StatusBadge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof TONES;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", TONES[tone], className)}>
      {children}
    </Badge>
  );
}
