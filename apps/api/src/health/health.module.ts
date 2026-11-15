import { Module } from "@nestjs/common";
import { TerminusModule } from "@nestjs/terminus";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { DatabaseHealthIndicator } from "./database.health";
import { HealthController } from "./health.controller";
import { RedisHealthIndicator } from "./redis.health";

@Module({
  imports: [TerminusModule, PrismaModule, RealtimeModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator, RedisHealthIndicator],
})
export class HealthModule {}
