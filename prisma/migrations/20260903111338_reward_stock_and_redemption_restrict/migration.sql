-- DropForeignKey
ALTER TABLE "redemptions" DROP CONSTRAINT "redemptions_rewardId_fkey";

-- AlterTable
ALTER TABLE "rewards" ADD COLUMN     "stock" INTEGER;

-- AddForeignKey
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
