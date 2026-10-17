import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { UnreadModule } from "../unread/unread.module";
import { EventsController } from "./events.controller";

/**
 * The stream, kept apart from the transport because it is the one place that knows what a
 * fresh connection is told first: the opening `sync` restates the counts of every feature
 * that pushes — the notifications and the threads, both counted by `UnreadModule`.
 */
@Module({
  imports: [RealtimeModule, UnreadModule],
  controllers: [EventsController],
})
export class EventsModule {}
