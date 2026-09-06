-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "morningWindowEndMinute" INTEGER NOT NULL DEFAULT 450,
ADD COLUMN     "morningWindowStartMinute" INTEGER NOT NULL DEFAULT 300;
