import { cn } from "@/lib/utils";

// iOS UISegmentedControl look. No client JS/state: each option is a real
// `<button type="submit" name=... value=...>` inside the surrounding
// <form> (the form's action and other hidden fields are unchanged by
// this — only which segment is clicked determines the submitted value),
// so this works with the exact same Server Actions as a plain submit
// button, just rendered as two labeled segments with the active one
// highlighted instead of one toggle badge.
export function SegmentedControl({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("inline-flex items-center gap-0.5 rounded-full bg-muted p-1", className)}>{children}</div>;
}

export function SegmentedOption({
  active,
  className,
  ...props
}: { active: boolean } & React.ComponentProps<"button">) {
  return (
    <button
      type="submit"
      aria-pressed={active}
      className={cn(
        "min-h-9 rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors",
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
