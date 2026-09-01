import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { getPackingStatus } from "@/lib/packing";
import { schoolTomorrow } from "@/lib/time";
import { ScanView } from "@/components/scan-view";

export default async function ScanPage() {
  const actor = await requireActor();
  if (!actor.studentId) redirect("/");

  const status = await getPackingStatus(actor.studentId, schoolTomorrow());
  if (status.isComplete || status.total === 0) redirect("/student/tomorrow");

  return (
    <div className="pt-2">
      <ScanView items={status.items} />
    </div>
  );
}
