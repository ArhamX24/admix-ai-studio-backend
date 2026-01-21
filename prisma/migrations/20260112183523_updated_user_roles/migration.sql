/*
  Warnings:

  - The values [USER] on the enum `user_roles` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "user_roles_new" AS ENUM ('ADMIN', 'NEWS_GENERATOR', 'AUDIO_GENERATOR', 'VIDEO_GENERATOR', 'SCRIPT_WRITER', 'VOICE_GENERATOR');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "user_roles_new" USING ("role"::text::"user_roles_new");
ALTER TYPE "user_roles" RENAME TO "user_roles_old";
ALTER TYPE "user_roles_new" RENAME TO "user_roles";
DROP TYPE "user_roles_old";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
COMMIT;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
