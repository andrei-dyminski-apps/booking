import { BadRequestException, Injectable, ParseUUIDPipe } from "@nestjs/common";
import { apiException } from "./api-exception";

/**
 * Nest's `ParseUUIDPipe` for the `:id` of a path, answering `INVALID_ID` where the stock
 * pipe answers a bare `400` — which would carry the code of its status, `BAD_REQUEST`, and
 * say nothing of what was wrong. One code for every resource: which path segment it was is
 * in the URL the client sent, not something a rule has to restate.
 */
@Injectable()
export class ParseIdPipe extends ParseUUIDPipe {
  constructor() {
    super({
      exceptionFactory: () =>
        apiException(
          BadRequestException,
          "INVALID_ID",
          "An id has to be a UUID",
        ),
    });
  }
}
