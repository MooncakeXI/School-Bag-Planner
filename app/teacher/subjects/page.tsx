import { Trash2 } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createSubjectAction,
  createSubjectItemAction,
  deleteSubjectAction,
  deleteSubjectItemAction,
} from "./actions";

export default async function TeacherSubjectsPage() {
  const subjects = await prisma.subject.findMany({
    select: { id: true, name: true, subjectItems: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-xl font-semibold">วิชาและอุปกรณ์การเรียน</h1>
        <p className="text-sm text-muted-foreground">
          รายวิชาและของที่ต้องเตรียมต่อวิชา — ใช้ร่วมกันทุกห้องเรียนในโรงเรียน
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {subjects.map((subject) => (
          <Card key={subject.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{subject.name}</CardTitle>
                <form action={deleteSubjectAction}>
                  <input type="hidden" name="subjectId" value={subject.id} />
                  <Button type="submit" variant="ghost" size="sm">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </form>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <ul className="flex flex-col gap-1">
                {subject.subjectItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between text-sm">
                    <span>{item.name}</span>
                    <form action={deleteSubjectItemAction}>
                      <input type="hidden" name="subjectItemId" value={item.id} />
                      <Button type="submit" variant="ghost" size="sm" className="h-6 px-2">
                        <Trash2 className="size-3.5 text-destructive" />
                      </Button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={createSubjectItemAction} className="flex items-center gap-2 pt-1">
                <input type="hidden" name="subjectId" value={subject.id} />
                <Input name="name" placeholder="เพิ่มของที่ต้องเตรียม เช่น แบบฝึกหัด..." className="h-8 text-sm" required />
                <Button type="submit" size="sm" variant="outline">
                  เพิ่ม
                </Button>
              </form>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">เพิ่มวิชาใหม่</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createSubjectAction} className="flex items-center gap-2">
            <Input name="name" placeholder="ชื่อวิชา" required />
            <Button type="submit">เพิ่ม</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
