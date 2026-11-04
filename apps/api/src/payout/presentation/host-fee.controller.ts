import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Role, type HostFeeOverview } from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { HostFeeService } from "../application/host-fee.service";
import {
  HostFeeOverviewDto,
  HostFeeQueryDto,
  WaiveHostFeeDto,
} from "./dto/payout.dto";

/**
 * The fees hosts owe for cancelling paid stays. A host reads their own — no id in the
 * route, the session names them — and an admin reads any host's and waives a fee.
 */
@Controller("host-fees")
export class HostFeeController {
  constructor(private readonly hostFeeService: HostFeeService) {}

  @Get("mine")
  @Roles(Role.USER)
  @ApiOkResponse({ type: HostFeeOverviewDto })
  mine(@CurrentUser() user: AuthenticatedUser): Promise<HostFeeOverview> {
    return this.hostFeeService.overviewOf(user.id, "host");
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: HostFeeOverviewDto })
  ofHost(@Query() query: HostFeeQueryDto): Promise<HostFeeOverview> {
    return this.hostFeeService.overviewOf(query.hostId, "admin");
  }

  @Post(":id/waive")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.ADMIN)
  @ApiNoContentResponse()
  @ApiUnauthorizedResponse({
    description: "The account behind the token no longer exists",
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description:
      "The caller has been blocked or demoted since the token was issued",
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: "The fee does not exist",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "The fee was waived already, or withheld in full",
    type: ApiErrorDto,
  })
  waive(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: WaiveHostFeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.hostFeeService.waive(id, dto.reason, user.id);
  }
}
