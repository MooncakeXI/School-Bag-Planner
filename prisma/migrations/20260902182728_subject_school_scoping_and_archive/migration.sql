-- AlterTable
ALTER TABLE "subject_items" ADD COLUMN     "archivedAt" TIMESTAMP(3);

-- AlterTable: schoolId is added nullable first, backfilled, then locked to NOT NULL —
-- there is no natural default, and existing rows must resolve to a real school.
ALTER TABLE "subjects" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "schoolId" TEXT;

-- Backfill: at the time this migration was authored there is exactly one School row,
-- and the curriculum catalog was (incorrectly) treated as shared across all schools —
-- so every existing Subject is assigned to that single school. If this migration is
-- ever replayed against a database that already has more than one school, this
-- statement is wrong for any Subject that conceptually belongs to a different school;
-- it is safe here only because this is the migration that introduces per-school
-- scoping in the first place.
UPDATE "subjects" SET "schoolId" = (SELECT "id" FROM "schools" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "schoolId" IS NULL;

-- AlterTable
ALTER TABLE "subjects" ALTER COLUMN "schoolId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "subjects_schoolId_idx" ON "subjects"("schoolId");

-- AddForeignKey
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;
