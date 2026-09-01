import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireActor } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const AVATAR_PALETTE = [
  { bg: "#FBEAE1", fg: "#C2542E" },
  { bg: "#E2F0F6", fg: "#1B6480" },
  { bg: "#E4F1EA", fg: "#2E7D5B" },
  { bg: "#FDF0D5", fg: "#8A5E06" },
];

function avatarFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export default async function ParentPage() {
  const actor = await requireActor();

  const children = await prisma.student.findMany({
    where: { guardianships: { some: { parentId: actor.parentId! } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <main className="flex flex-col gap-4 max-w-lg mx-auto w-full pt-4">
      <h1 className="font-heading text-2xl font-semibold text-center">ลูกของฉัน</h1>
      {children.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">ยังไม่มีข้อมูลบุตรหลานผูกกับบัญชีนี้</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {children.map((c) => {
            const avatar = avatarFor(c.name);
            return (
              <li key={c.id}>
                <Link
                  href={`/parent/${c.id}`}
                  className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3.5 transition-colors hover:bg-accent"
                >
                  <span
                    className="flex size-12 shrink-0 items-center justify-center rounded-full font-heading text-lg font-semibold"
                    style={{ background: avatar.bg, color: avatar.fg }}
                    aria-hidden
                  >
                    {c.name.slice(0, 1)}
                  </span>
                  <span className="flex-1 text-base font-semibold">{c.name}</span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
