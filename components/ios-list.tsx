import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

// iOS Settings.app-style grouped inset list: a small uppercase caption
// above a rounded card of divided rows. Used across /teacher/* wherever
// content is a list of similar things (classrooms, subjects, rewards).
export function ListGroup({
  label,
  action,
  footer,
  children,
  className,
}: {
  label?: React.ReactNode;
  /** An optional control shown trailing the label, e.g. a "rapid scan" button. */
  action?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {(label || action) && (
        <div className="flex items-center justify-between gap-2 px-4">
          {label && <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>}
          {action}
        </div>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-2xl bg-card ring-1 ring-border shadow-[0_1px_2px_rgba(0,0,0,0.04),0_6px_20px_-6px_rgba(0,0,0,0.12)]">
        {children}
      </div>
      {footer && <div className="px-4 text-xs text-muted-foreground">{footer}</div>}
    </div>
  );
}

/** One row in a ListGroup. `href` makes it a full-row link with a trailing
 * chevron (unless `chevron={false}`); otherwise it's a plain row for
 * embedding a form, badge, or other trailing control. Minimum 44px tall —
 * this app's audience skews low-tech, tap targets stay generous everywhere. */
export function ListRow({
  href,
  leading,
  trailing,
  chevron = true,
  children,
  className,
}: {
  href?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {leading}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing}
      {href && chevron && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />}
    </>
  );

  const rowClass = cn("flex min-h-11 items-center gap-3 px-4 py-2.5 text-sm", className);

  if (href) {
    return (
      <Link href={href} className={cn(rowClass, "transition-colors active:bg-muted")}>
        {content}
      </Link>
    );
  }
  return <div className={rowClass}>{content}</div>;
}
