import { redirect } from "next/navigation";
import { requireActor } from "@/lib/session";
import { getPackingStatus, packingFocusDate } from "@/lib/packing";
import { schoolSettingsForStudent } from "@/lib/school-settings";
import { ScanView } from "@/components/scan-view";

export default async function ScanPage() {
  const actor = await requireActor();
  if (!actor.studentId) redirect("/");

  const settings = await schoolSettingsForStudent(actor.studentId);
  const status = await getPackingStatus(actor.studentId, packingFocusDate(settings));
  if (status.isComplete || status.total === 0) redirect("/student/tomorrow");

  return (
    <div className="pt-2">
      <ScanView items={status.items} />
    </div>
  );
}
