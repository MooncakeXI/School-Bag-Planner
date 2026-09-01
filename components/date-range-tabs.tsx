import Link from "next/link";
import { cn } from "@/lib/utils";

// Server-rendered — no client JS needed since each page already knows
// which tab it is.
export function DateRangeTabs({
  active,
  tomorrowHref,
  weekHref,
}: {
  active: "tomorrow" | "week";
  tomorrowHref: string;
  weekHref: string;
}) {
  const tabClass = (isActive: boolean) =>
    cn(
      "flex-1 rounded-xl py-2.5 text-center text-base font-semibold transition-colors",
      isActive ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="mx-auto flex w-full max-w-lg gap-1 rounded-2xl bg-muted p-1.5">
      <Link href={tomorrowHref} className={tabClass(active === "tomorrow")}>
        พรุ่งนี้
      </Link>
      <Link href={weekHref} className={tabClass(active === "week")}>
        สัปดาห์นี้
      </Link>
    </div>
  );
}
