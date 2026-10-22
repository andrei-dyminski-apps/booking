import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { PrismaModule } from "../prisma/prisma.module";
import { WaitlistController } from "./waitlist.controller";
import { WaitlistRepository } from "./waitlist.repository";
import { WaitlistService } from "./waitlist.service";

@Module({
  // NotificationModule to tell a waiter their nights came free. Not BookingModule: whether
  // nights are taken is a `where` imported from its repository's file, not a provider, and
  // BookingModule is the one that depends on this module.
  imports: [PrismaModule, NotificationModule],
  controllers: [WaitlistController],
  providers: [WaitlistService, WaitlistRepository],
  // `announceFreed` for BookingService, after a cancellation and a lapsed hold.
  exports: [WaitlistService],
})
export class WaitlistModule {}
