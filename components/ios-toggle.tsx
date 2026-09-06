import { Switch } from "@base-ui/react/switch";
import { cn } from "@/lib/utils";

// iOS-style toggle switch for a boolean form field — thin wrapper around
// @base-ui/react's Switch (renders its own hidden <input>, so it drops
// into a plain <form> like Input/Label do). No current caller: today's
// /teacher/* pages have no boolean setting exposed in the UI (Reward.active
// exists in the schema but isn't wired to any form). Kept small on purpose
// — add an onCheckedChange auto-submit only once a real page needs one.
export function Toggle({
  name,
  defaultChecked,
  disabled,
  className,
}: {
  name: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Switch.Root
      name={name}
      defaultChecked={defaultChecked}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-8 w-[52px] shrink-0 items-center rounded-full bg-muted transition-colors data-[checked]:bg-success",
        className,
      )}
    >
      <Switch.Thumb className="block size-6 translate-x-1 rounded-full bg-card shadow transition-transform data-[checked]:translate-x-[26px]" />
    </Switch.Root>
  );
}
