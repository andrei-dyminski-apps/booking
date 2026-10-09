import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { LookupController } from "./lookup.controller";
import { LookupRepository } from "./lookup.repository";
import { LookupService } from "./lookup.service";

@Module({
  imports: [PrismaModule],
  controllers: [LookupController],
  providers: [LookupService, LookupRepository],
})
export class LookupModule {}
