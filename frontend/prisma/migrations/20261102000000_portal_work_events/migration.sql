-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "reimbursedAt" TIMESTAMP(3),
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "submittedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dueReminderSentAt" TIMESTAMP(3),
ADD COLUMN     "overdueNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "recurrenceSourceId" TEXT;

-- CreateIndex
CREATE INDEX "Outreach_followUpAt_idx" ON "Outreach"("followUpAt");

