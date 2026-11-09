-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STAY_ENDED_EARLY';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "ended_early_at" TIMESTAMP(3);
