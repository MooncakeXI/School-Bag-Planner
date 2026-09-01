-- AlterTable
ALTER TABLE "students" ADD COLUMN     "studentCode" TEXT,
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "students_studentCode_key" ON "students"("studentCode");
