import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { NotificationController } from "./notification.controller";
import { NotificationRepository } from "./notification.repository";
import { NotificationService } from "./notification.service";

@Module({
  imports: [PrismaModule, RealtimeModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationRepository],
  // `notify` for the modules that have something to say — bookings and reviews so far —
  // and the count for the stream's opening `sync`.
  exports: [NotificationService],
})
export class NotificationModule {}
