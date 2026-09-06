"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { redeemAction } from "@/app/student/rewards/actions";

// Client wrapper so a redemption race (stock/balance changed between page
// render and tap) surfaces as an inline message next to this specific
// reward, not a full-page crash via app/error.tsx — see actions.ts.
export function RedeemButton({
  rewardId,
  canAfford,
  outOfStock,
}: {
  rewardId: string;
  canAfford: boolean;
  outOfStock: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    const result = await redeemAction(rewardId);
    if (result.ok) {
      router.refresh();
    } else {
      setError(result.error);
      setPending(false);
    }
  }

  const disabled = !canAfford || pending;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={cn(
          "h-[46px] min-w-[84px] rounded-2xl px-5 text-[15px] font-semibold disabled:cursor-default",
          canAfford ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {pending ? "..." : outOfStock ? "หมดแล้ว" : canAfford ? "แลก" : "ยังไม่พอ"}
      </button>
      {error && (
        <p role="alert" className="max-w-[140px] text-right text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
