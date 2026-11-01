import { z } from "zod";
import {
  failedPaymentEventPageSchema,
  type FailedPaymentEventPage,
  type FailedPaymentEventQuery,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * The payment provider's deliveries as the admin's section sees them: the ones the inbox's
 * worker gave up on, and the way to hand one back. Every route is `@Roles(Role.ADMIN)` on
 * the API side, and nothing here repeats that.
 */
export const paymentEventsApi = {
  failed: (
    query: FailedPaymentEventQuery,
    read: ReadOptions,
  ): Promise<FailedPaymentEventPage> =>
    apiRequest({
      method: "GET",
      path: `/payment-events/failed${queryString(query)}`,
      schema: failedPaymentEventPageSchema,
      read,
    }),

  /** Queued at once; the handlers are idempotent, so a retry is safe. */
  retry: (id: string): Promise<void> =>
    apiRequest({
      method: "POST",
      path: `/payment-events/${encodeURIComponent(id)}/retry`,
      schema: z.void(),
    }),
};
