-- CreateEnum
CREATE TYPE "QRCodeState" AS ENUM ('UNASSIGNED', 'ASSIGNED', 'VOID');

-- CreateTable
CREATE TABLE "qr_codes" (
    "code" TEXT NOT NULL,
    "state" "QRCodeState" NOT NULL DEFAULT 'UNASSIGNED',
    "itemCopyId" TEXT,
    "boundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "qr_codes_itemCopyId_idx" ON "qr_codes"("itemCopyId");

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_itemCopyId_fkey" FOREIGN KEY ("itemCopyId") REFERENCES "item_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

