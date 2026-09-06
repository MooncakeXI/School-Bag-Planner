import { Users } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { visibleClassroomWhere } from "@/lib/policy";
import { PageHeader } from "@/components/page-header";
import { ListGroup, ListRow } from "@/components/ios-list";
import { RowIcon } from "@/components/row-icon";

export default async function TeacherClassroomsPage() {
  const actor = await requireActor();

  const classrooms = await prisma.classroom.findMany({
    where: visibleClassroomWhere(actor),
    select: { id: true, name: true, _count: { select: { enrollments: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ห้องเรียน" subtitle="ห้องเรียนที่คุณสอนอยู่" />

      {classrooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          บัญชีนี้ยังไม่มีห้องเรียนผูกอยู่ กรุณาให้ผู้ดูแลระบบตั้งค่าห้องเรียนของเทอมนี้ให้ก่อน
        </p>
      ) : (
        <ListGroup>
          {classrooms.map((c) => (
            <ListRow
              key={c.id}
              href={`/teacher/classrooms/${c.id}`}
              leading={<RowIcon icon={Users} tone="primary" />}
              trailing={<span className="text-sm text-muted-foreground">{c._count.enrollments} คน</span>}
            >
              <span className="font-medium">{c.name}</span>
            </ListRow>
          ))}
        </ListGroup>
      )}
    </div>
  );
}
