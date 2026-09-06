import "dotenv/config";
import { prisma } from "../lib/prisma";
import { deletePhotosForChecks } from "../lib/photo-storage";

// CLAUDE.md "Privacy": packing photos are purged after a configurable
// retention period, default 90 days. Run this via an external scheduler
// (cron/hosting-platform scheduler) — there is no in-process job runner here.
const RETENTION_DAYS = 90;

async function main() {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.packingCheck.findMany({
    where: { photoPath: { not: null }, createdAt: { lt: cutoff } },
    select: { id: true, photoPath: true },
  });

  const deleted = await deletePhotosForChecks(stale);
  console.log(`Purged ${deleted} packing photo(s) older than ${RETENTION_DAYS} days.`);
}

main().finally(() => prisma.$disconnect());
