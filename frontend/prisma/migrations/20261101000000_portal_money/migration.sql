-- DropIndex
DROP INDEX "MonthlyMetric_month_scope_memberId_teamId_key";

-- AlterTable
ALTER TABLE "MonthlyMetric" ADD COLUMN     "key" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Outreach" ADD COLUMN     "followUpNotifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyMetric_key_key" ON "MonthlyMetric"("key");

-- CreateIndex
CREATE INDEX "MonthlyMetric_month_scope_idx" ON "MonthlyMetric"("month", "scope");

