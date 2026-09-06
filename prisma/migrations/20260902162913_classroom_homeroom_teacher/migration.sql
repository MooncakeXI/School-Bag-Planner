-- AlterTable
ALTER TABLE "classrooms" ADD COLUMN     "homeroomTeacherId" TEXT;

-- CreateIndex
CREATE INDEX "classrooms_homeroomTeacherId_idx" ON "classrooms"("homeroomTeacherId");

-- AddForeignKey
ALTER TABLE "classrooms" ADD CONSTRAINT "classrooms_homeroomTeacherId_fkey" FOREIGN KEY ("homeroomTeacherId") REFERENCES "teachers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
