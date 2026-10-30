import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
} from "@nestjs/swagger";
import { Role, type RefundFailurePage } from "@repo/contracts";
import { Roles } from "../../auth/decorators/roles.decorator";
import { ApiErrorDto } from "../../common/dto/api-error.dto";
import { RefundFailureService } from "../application/refund-failure.service";
import {
  RefundFailurePageDto,
  RefundFailureQueryDto,
  ResolveRefundFailureDto,
} from "./dto/booking.dto";

/** The refunds a guest's bank sent back. The admin's alone, stated once on the class. */
@Controller("refund-failures")
@Roles(Role.ADMIN)
export class RefundFailureController {
  constructor(private readonly refundFailureService: RefundFailureService) {}

  @Get()
  @ApiOkResponse({ type: RefundFailurePageDto })
  @ApiBadRequestResponse({
    description:
      "The cursor was not issued by this list, or was issued under the other `status`",
    type: ApiErrorDto,
  })
  findPage(@Query() query: RefundFailureQueryDto): Promise<RefundFailurePage> {
    return this.refundFailureService.findPage(query);
  }

  /** Records how the money went back; it sends nothing. */
  @Post(":id/resolve")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: "No refund with this id came back",
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: "The failure is resolved already",
    type: ApiErrorDto,
  })
  resolve(
    @Param("id") id: string,
    @Body() dto: ResolveRefundFailureDto,
  ): Promise<void> {
    return this.refundFailureService.resolve(id, dto);
  }
}
