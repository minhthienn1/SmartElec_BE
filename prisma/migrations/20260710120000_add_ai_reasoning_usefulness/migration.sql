-- CreateEnum
CREATE TYPE "UsefulnessLabel" AS ENUM ('USEFUL', 'PARTIAL', 'NOT_USEFUL');

-- AlterTable
ALTER TABLE "ai_reasoning_logs"
ADD COLUMN "autoUsefulnessLabel" "UsefulnessLabel",
ADD COLUMN "autoUsefulnessReasons" TEXT[],
ADD COLUMN "autoUsefulnessScore" INTEGER,
ADD COLUMN "humanUsefulnessLabel" "UsefulnessLabel",
ADD COLUMN "humanUsefulnessNote" TEXT,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewedById" INTEGER;

-- AddForeignKey
ALTER TABLE "ai_reasoning_logs"
ADD CONSTRAINT "ai_reasoning_logs_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
