-- AlterTable
ALTER TABLE "packing_sessions" ADD COLUMN     "continuous" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "schools" ADD COLUMN     "packingWindowEndHour" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "packingWindowStartHour" INTEGER NOT NULL DEFAULT 18,
ADD COLUMN     "pointsPerCompletion" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "sessionTtlMinutes" INTEGER NOT NULL DEFAULT 20;
