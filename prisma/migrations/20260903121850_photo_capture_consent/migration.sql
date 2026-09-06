-- CreateEnum
CREATE TYPE "ConsentScope" AS ENUM ('PHOTO_CAPTURE');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('ONLINE', 'PAPER');

-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scope" "ConsentScope" NOT NULL,
    "version" TEXT NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "grantedByParentId" TEXT,
    "recordedByUserId" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "consents_studentId_scope_idx" ON "consents"("studentId", "scope");

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
