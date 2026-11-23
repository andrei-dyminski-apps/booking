-- AlterTable
ALTER TABLE "users" ALTER COLUMN "muted_mail_groups" SET DEFAULT ARRAY['stays', 'payments', 'waitlist', 'messages']::TEXT[];
