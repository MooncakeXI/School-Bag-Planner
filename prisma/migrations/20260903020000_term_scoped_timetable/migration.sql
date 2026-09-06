-- CreateTable
CREATE TABLE "terms" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terms_schoolId_startDate_idx" ON "terms"("schoolId", "startDate");

-- AddForeignKey
ALTER TABLE "terms" ADD CONSTRAINT "terms_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one Term per school that currently has any TimetableSlot at all,
-- covering "the current academic year" (Thai school year runs roughly
-- May-March), so every existing slot has somewhere to attach to. If this
-- migration is ever replayed against a database that already models real
-- terms, this step is a no-op in spirit but would still fire — it is safe
-- here only because this is the migration that introduces Term in the
-- first place, exactly like subject_school_scoping_and_archive's schoolId
-- backfill before it.
INSERT INTO "terms" ("id", "schoolId", "name", "startDate", "endDate", "updatedAt")
SELECT
    gen_random_uuid()::text,
    s."id",
    'ปีการศึกษา 2569',
    DATE '2026-05-01',
    DATE '2027-03-31',
    CURRENT_TIMESTAMP
FROM "schools" s
WHERE EXISTS (
    SELECT 1 FROM "timetable_slots" ts
    JOIN "classrooms" c ON c."id" = ts."classroomId"
    WHERE c."schoolId" = s."id"
);

-- AlterTable: termId is added nullable first, backfilled from each slot's
-- classroom's school, then locked to NOT NULL.
ALTER TABLE "timetable_slots" ADD COLUMN     "termId" TEXT;

UPDATE "timetable_slots" ts
SET "termId" = t."id"
FROM "classrooms" c
JOIN "terms" t ON t."schoolId" = c."schoolId"
WHERE c."id" = ts."classroomId"
AND ts."termId" IS NULL;

ALTER TABLE "timetable_slots" ALTER COLUMN "termId" SET NOT NULL;

-- DropIndex
DROP INDEX "timetable_slots_classroomId_weekday_period_key";

-- CreateIndex
CREATE INDEX "timetable_slots_termId_idx" ON "timetable_slots"("termId");

-- CreateIndex
CREATE UNIQUE INDEX "timetable_slots_termId_classroomId_weekday_period_key" ON "timetable_slots"("termId", "classroomId", "weekday", "period");

-- AddForeignKey
ALTER TABLE "timetable_slots" ADD CONSTRAINT "timetable_slots_termId_fkey" FOREIGN KEY ("termId") REFERENCES "terms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
