import { z } from "zod";
import {
  hostFeeOverviewSchema,
  type HostFeeOverview,
  type WaiveHostFeeInput,
} from "@repo/contracts";
import { apiRequest } from "./http-client";

/**
 * What hosts owe for cancelling paid stays. Both reads are personal — the caller's own, or
 * one host's for an admin — and never cached, so neither takes `ReadOptions`.
 */
export const hostFeesApi = {
  /** The caller's own fees, what is still owed and their cancellations of the last year. */
  mine: (): Promise<HostFeeOverview> =>
    apiRequest({
      method: "GET",
      path: "/host-fees/mine",
      schema: hostFeeOverviewSchema,
      read: { cache: "no-store" },
    }),

  /** One host's, for the admin's page of an account. */
  ofHost: (hostId: string): Promise<HostFeeOverview> =>
    apiRequest({
      method: "GET",
      path: `/host-fees?hostId=${encodeURIComponent(hostId)}`,
      schema: hostFeeOverviewSchema,
      read: { cache: "no-store" },
    }),

  /** The admin's: what was withheld already stays withheld. */
  waive: (id: string, input: WaiveHostFeeInput): Promise<void> =>
    apiRequest({
      method: "POST",
      path: `/host-fees/${encodeURIComponent(id)}/waive`,
      schema: z.void(),
      body: input,
    }),
};
