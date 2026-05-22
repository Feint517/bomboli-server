-- Replace the role enum with an isAdmin boolean. Seller / Deliverer
-- capabilities are now expressed via SellerProfile / Deliverer row
-- existence; the `role` column was a redundant single-value field that
-- couldn't represent multi-role users (a user can be both buyer and
-- seller in a marketplace).

-- 1. Add isAdmin column with a safe default.
ALTER TABLE "users" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Carry over existing admins.
UPDATE "users" SET "isAdmin" = TRUE WHERE "role" = 'ADMIN';

-- 3. Drop the role column.
ALTER TABLE "users" DROP COLUMN "role";

-- 4. Drop the now-unused enum type.
DROP TYPE "UserRole";
