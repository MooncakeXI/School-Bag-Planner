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

export function SubjectChip({ subjectName, className }: { subjectName: string; className?: string }) {
  const { bg, fg } = colorFor(subjectName);
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-semibold leading-tight",
        className,
      )}
      style={{ background: bg, color: fg }}
      aria-hidden
    >
      {subjectName.slice(0, 2)}
    </span>
  );
}
