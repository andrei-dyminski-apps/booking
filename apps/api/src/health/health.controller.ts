import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  HealthCheck,
  HealthCheckService,
  type HealthCheckResult,
} from "@nestjs/terminus";
import { Public } from "../auth/decorators/public.decorator";
import { DatabaseHealthIndicator } from "./database.health";
import { HEALTH_PATH } from "./health-path";
import { RedisHealthIndicator } from "./redis.health";

@ApiTags("Status")
@Controller(HEALTH_PATH)
export class HealthController {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly databaseHealthIndicator: DatabaseHealthIndicator,
    private readonly redisHealthIndicator: RedisHealthIndicator,
  ) {}

  /**
   * Ready, not merely alive: `200` only while Postgres and Redis both answer, `503` naming
   * which did not. It is what the platform waits on before it moves traffic to a new
   * deployment, and an API that cannot reach its database is not one to move it to.
   */
  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: "Answer if the API can reach Postgres and Redis" })
  check(): Promise<HealthCheckResult> {
    return this.healthCheckService.check([
      () => this.databaseHealthIndicator.pingCheck("database"),
      () => this.redisHealthIndicator.pingCheck("redis"),
    ]);
  }
}
