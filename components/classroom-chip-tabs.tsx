import Link from "next/link";
import { cn } from "@/lib/utils";

// Horizontal scrolling chip selector for "which classroom" (iOS pattern —
// e.g. Maps' transit-type chips, App Store category chips). A real
// UISegmentedControl doesn't scale past ~5 fixed options; a school can have
// many more classrooms, so a scrollable chip row is the closer iOS fit.
// Shared by /teacher/timetable and /teacher/exceptions, which both switch
// classroom via the same `?classroomId=` query param.
export function ClassroomChipTabs({
  classrooms,
  activeId,
  hrefFor,
}: {
  classrooms: { id: string; name: string }[];
  activeId: string;
  hrefFor: (classroomId: string) => string;
}) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
      {classrooms.map((c) => (
        <Link
          key={c.id}
          href={hrefFor(c.id)}
          aria-current={c.id === activeId ? "page" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center rounded-full px-5 text-base font-semibold whitespace-nowrap transition-colors",
            c.id === activeId ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {c.name}
        </Link>
      ))}
    </div>
  );
}
