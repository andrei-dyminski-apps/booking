import { NotFoundException, type HttpException } from "@nestjs/common";
import { apiException } from "../common/api-exception";

/**
 * The `404` of a listing that is not there or is retired, shared by every slice that
 * raises it. The id stays in the sentence for the log; a client reads the code.
 */
export function listingNotFound(id: string): HttpException {
  return apiException(
    NotFoundException,
    "LISTING_NOT_FOUND",
    `Listing ${id} not found`,
  );
}
