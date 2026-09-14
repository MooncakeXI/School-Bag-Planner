import { cn } from "@/lib/utils";

// Deterministic-by-name palette, same technique as components/subject-chip.tsx
// (so the same student always gets the same color without per-school
// hardcoding). Gives the roster page's per-student cards a contact-list /
// avatar feel instead of a bare name in a plain header.
const PALETTE = [
  { bg: "#EDE7FF", fg: "#5B3FA8" },
  { bg: "#FBEAE1", fg: "#9C3F1F" },
  { bg: "#E4F1EA", fg: "#2E7D5B" },
  { bg: "#E2F0F6", fg: "#1B6480" },
  { bg: "#FDF0D5", fg: "#8A5E06" },
];

function colorFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function shortStudentName(name: string) {
  return name.replace(/^(เด็กชาย|เด็กหญิง|ด\.ช\.|ด\.ญ\.|นาย|นางสาว)\s*/, "").trim() || name;
}

function initialFor(name: string) {
  const shortName = shortStudentName(name);
  return shortName.match(/#(\d+)$/)?.[1] ?? shortName.slice(0, 1);
}

// Solid-fill status colors — deliberately a different visual language from
// the soft name-hash tint above: a solid traffic-light color reads as
// *state* (packed / partly packed / not started), where the tinted circle
// reads as *identity*. Reuses the same success/warning tokens as
// components/row-icon.tsx's tones, just solid instead of at 15% opacity.
const STATUS_STYLE = {
  complete: "bg-success text-success-foreground",
  partial: "bg-warning text-warning-foreground",
  not_started: "bg-muted-foreground/40 text-background",
} as const;

export function StudentAvatar({
  name,
  status,
  className,
}: {
  name: string;
  /** When given, overrides the name-hash tint with a solid status color. */
  status?: keyof typeof STATUS_STYLE;
  className?: string;
}) {
  if (status) {
    return (
      <span
        className={cn(
          "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          STATUS_STYLE[status],
          className,
        )}
        aria-hidden
      >
        {initialFor(name)}
      </span>
    );
  }

  const { bg, fg } = colorFor(name);
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
        className,
      )}
      style={{ background: bg, color: fg }}
      aria-hidden
    >
      {initialFor(name)}
    </span>
  );
}
