import { Module } from "@nestjs/common";
import { RealtimeService } from "./realtime.service";

/**
 * The push transport and nothing else: no controller and no domain. A module that has
 * something to tell a browser imports this and publishes; the stream itself is
 * `EventsModule`, which also knows what a fresh connection has to be told first.
 */
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
