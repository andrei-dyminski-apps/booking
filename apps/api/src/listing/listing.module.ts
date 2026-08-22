import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ListingController } from "./listing.controller";
import { ListingRepository } from "./listing.repository";
import { ListingService } from "./listing.service";

@Module({
  imports: [PrismaModule],
  controllers: [ListingController],
  providers: [ListingService, ListingRepository],
})
export class ListingModule {}
