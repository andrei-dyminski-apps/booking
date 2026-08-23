-- DropForeignKey
ALTER TABLE "listings" DROP CONSTRAINT "listings_owner_id_fkey";

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
