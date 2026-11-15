import { Injectable } from "@nestjs/common";
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from "@nestjs/terminus";
import { PrismaService } from "../prisma/prisma.service";

/** A second is what the platform's probe should wait for a `SELECT 1`, not the pool's five. */
const PING_TIMEOUT_MS = 1_000;

/**
 * Not Terminus's `PrismaHealthIndicator`: that one sends MongoDB's ping first and falls
 * back to `SELECT 1` only when Prisma's error says "Use the mongodb provider", so a
 * reworded message would leave the probe down for good and every deploy waiting on it.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * `down` with no reason: the error names hosts and ports, and the route is public. A
   * query that outlives the timeout is not cancelled — Prisma takes no signal — it only
   * stops being waited for.
   */
  async pingCheck<const Key extends string>(
    key: Key,
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`no answer within ${String(PING_TIMEOUT_MS)}ms`));
      }, PING_TIMEOUT_MS);
    });

    try {
      await Promise.race([this.prismaService.$queryRaw`SELECT 1`, timedOut]);
    } catch {
      return check.down();
    } finally {
      clearTimeout(timer);
    }

    return check.up();
  }
}
