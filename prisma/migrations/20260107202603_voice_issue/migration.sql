-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "googleId" DROP NOT NULL,
ALTER COLUMN "refreshToken" DROP NOT NULL;

-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "VideoStatus" NOT NULL DEFAULT 'PENDING',
    "avatarId" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "script" TEXT NOT NULL,
    "duration" TEXT NOT NULL DEFAULT 'Auto',
    "language" TEXT NOT NULL DEFAULT 'hi',
    "heygenVideoId" TEXT,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "videoDuration" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "deleteAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voices" (
    "id" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL DEFAULT 'multilingual',
    "accent" TEXT,
    "labels" JSONB,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_samples" (
    "id" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "audioData" BYTEA,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "audioFilePath" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audio_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speech_history" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'multilingual',
    "voiceId" TEXT,
    "userId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "errorMessage" TEXT,
    "audioFilePath" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "duration" DOUBLE PRECISION,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "similarityBoost" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
    "style" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "useSpeakerBoost" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "speech_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voices_voiceId_key" ON "voices"("voiceId");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voices" ADD CONSTRAINT "voices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_samples" ADD CONSTRAINT "audio_samples_voiceId_fkey" FOREIGN KEY ("voiceId") REFERENCES "voices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speech_history" ADD CONSTRAINT "speech_history_voiceId_fkey" FOREIGN KEY ("voiceId") REFERENCES "voices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speech_history" ADD CONSTRAINT "speech_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
