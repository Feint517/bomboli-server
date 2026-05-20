-- AddColumns: mirror Supabase auth.users verification timestamps
ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "lastSignInAt" TIMESTAMP(3);
