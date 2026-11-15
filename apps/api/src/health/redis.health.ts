import { Injectable } from "@nestjs/common";
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from "@nestjs/terminus";
import { RealtimeService } from "../realtime/realtime.service";

/**
 * Terminus has no Redis indicator of its own. The ping goes through `RealtimeService`
 * rather than a connection opened for it: the queues and the pub/sub reach the same
 * server, and a third connection per instance would only be there to be probed.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly realtimeService: RealtimeService,
  ) {}

  /** `down` with no reason: the error names hosts and ports, and the route is public. */
  async pingCheck<const Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);

    try {
      await this.realtimeService.ping();
    } catch {
      return check.down();
    }

    return check.up();
  }
}
