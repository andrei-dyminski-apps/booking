import { z } from "zod";
import {
  refundFailurePageSchema,
  type RefundFailurePage,
  type RefundFailureQuery,
  type ResolveRefundFailureInput,
} from "@repo/contracts";
import { apiRequest, queryString, type ReadOptions } from "./http-client";

/**
 * The refunds a guest's bank sent back, as the admin's section reads and closes them. There
 * is no route that sends one again — the same card refuses it again — so resolving one is
 * a record of how the money went back some other way.
 */
export const refundFailuresApi = {
  page: (
    query: RefundFailureQuery,
    read: ReadOptions,
  ): Promise<RefundFailurePage> =>
    apiRequest({
      method: "GET",
      path: `/refund-failures${queryString(query)}`,
      schema: refundFailurePageSchema,
      read,
    }),

  resolve: (id: string, input: ResolveRefundFailureInput): Promise<void> =>
    apiRequest({
      method: "POST",
      path: `/refund-failures/${encodeURIComponent(id)}/resolve`,
      schema: z.void(),
      body: input,
    }),
};
