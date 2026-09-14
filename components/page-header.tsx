// iOS "large title" — a bold, big page title at the top of the content
// (not a scroll-collapsing nav-bar title; the nav bar itself stays compact,
// see app/teacher/layout.tsx). Every /teacher/* page uses this instead of
// its own ad-hoc <h1>.
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 className="font-heading text-3xl leading-tight font-bold tracking-tight sm:text-[34px]">{title}</h1>
      {subtitle && <p className="max-w-3xl text-base leading-relaxed text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
