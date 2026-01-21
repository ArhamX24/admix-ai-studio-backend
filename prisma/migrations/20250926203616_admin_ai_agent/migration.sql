-- CreateEnum
CREATE TYPE "public"."user_roles" AS ENUM ('ADMIN', 'USER');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "public"."user_roles" NOT NULL DEFAULT 'USER',
    "password" TEXT,
    "googleId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "public"."chat_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "agentName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "public"."message_history" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "users_id_key" ON "public"."users"("id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "public"."users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_history_id_key" ON "public"."chat_history"("id");

-- CreateIndex
CREATE UNIQUE INDEX "message_history_id_key" ON "public"."message_history"("id");

-- AddForeignKey
ALTER TABLE "public"."chat_history" ADD CONSTRAINT "chat_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."message_history" ADD CONSTRAINT "message_history_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "public"."chat_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;
