-- CreateTable
CREATE TABLE "homeworks" (
    "id" TEXT NOT NULL,
    "classroomId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "postedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "homeworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "homework_reminders" (
    "id" TEXT NOT NULL,
    "homeworkId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "homework_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "homeworks_classroomId_deadlineAt_idx" ON "homeworks"("classroomId", "deadlineAt");

-- CreateIndex
CREATE INDEX "homeworks_subjectId_idx" ON "homeworks"("subjectId");

-- CreateIndex
CREATE INDEX "homework_reminders_studentId_idx" ON "homework_reminders"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "homework_reminders_homeworkId_studentId_key" ON "homework_reminders"("homeworkId", "studentId");

-- AddForeignKey
ALTER TABLE "homeworks" ADD CONSTRAINT "homeworks_classroomId_fkey" FOREIGN KEY ("classroomId") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homeworks" ADD CONSTRAINT "homeworks_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "subjects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_reminders" ADD CONSTRAINT "homework_reminders_homeworkId_fkey" FOREIGN KEY ("homeworkId") REFERENCES "homeworks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "homework_reminders" ADD CONSTRAINT "homework_reminders_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE CASCADE ON UPDATE CASCADE;
