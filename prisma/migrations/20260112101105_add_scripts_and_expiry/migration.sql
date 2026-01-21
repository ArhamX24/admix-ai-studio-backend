/*
  Warnings:

  - You are about to drop the `speech_history` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."speech_history" DROP CONSTRAINT "speech_history_userId_fkey";

-- DropForeignKey
ALTER TABLE "public"."speech_history" DROP CONSTRAINT "speech_history_voiceId_fkey";

-- DropTable
DROP TABLE "public"."speech_history";

-- CreateTable
CREATE TABLE "Script" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "isVoiceGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeechHistory" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "audioFilePath" TEXT,
    "language" TEXT NOT NULL DEFAULT 'multilingual',
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "errorMessage" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "similarityBoost" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "style" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "useSpeakerBoost" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,
    "voiceId" TEXT,
    "scriptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "SpeechHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Script_userId_idx" ON "Script"("userId");

-- CreateIndex
CREATE INDEX "Script_isVoiceGenerated_createdAt_idx" ON "Script"("isVoiceGenerated", "createdAt");

-- CreateIndex
CREATE INDEX "SpeechHistory_userId_idx" ON "SpeechHistory"("userId");

-- CreateIndex
CREATE INDEX "SpeechHistory_voiceId_idx" ON "SpeechHistory"("voiceId");

-- CreateIndex
CREATE INDEX "SpeechHistory_scriptId_idx" ON "SpeechHistory"("scriptId");

-- CreateIndex
CREATE INDEX "SpeechHistory_status_idx" ON "SpeechHistory"("status");

-- CreateIndex
CREATE INDEX "SpeechHistory_expiresAt_idx" ON "SpeechHistory"("expiresAt");

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechHistory" ADD CONSTRAINT "SpeechHistory_voiceId_fkey" FOREIGN KEY ("voiceId") REFERENCES "voices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechHistory" ADD CONSTRAINT "SpeechHistory_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeechHistory" ADD CONSTRAINT "SpeechHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
