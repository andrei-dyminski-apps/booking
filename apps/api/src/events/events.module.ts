import { Module } from "@nestjs/common";
import { NotificationModule } from "../notification/notification.module";
import { RealtimeModule } from "../realtime/realtime.module";
import { EventsController } from "./events.controller";

/**
 * The stream, kept apart from the transport because it is the one place that knows every
 * feature that pushes: the opening `sync` restates each of their counts. The messages
 * between users are the next import here, beside the notifications.
 */
@Module({
  imports: [RealtimeModule, NotificationModule],
  controllers: [EventsController],
})
export class EventsModule {}
