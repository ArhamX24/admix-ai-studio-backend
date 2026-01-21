-- CreateEnum
CREATE TYPE "RoleType" AS ENUM ('NEWS_GENERATOR', 'AUDIO_GENERATOR', 'VIDEO_GENERATOR', 'SCRIPT_WRITER', 'VOICE_GENERATOR');

-- CreateTable
CREATE TABLE "assigned_roles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleType" "RoleType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assigned_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assigned_roles_userId_key" ON "assigned_roles"("userId");

-- AddForeignKey
ALTER TABLE "assigned_roles" ADD CONSTRAINT "assigned_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
