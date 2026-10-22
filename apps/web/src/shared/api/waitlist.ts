import { z } from "zod";
import {
  waitlistDemandPageSchema,
  waitlistEntrySchema,
  waitlistSchema,
  type JoinWaitlistInput,
  type WaitlistDemandPage,
  type WaitlistDemandQuery,
  type WaitlistEntry,
} from "@repo/contracts";
import { apiRequest, queryString } from "./http-client";

/**
 * The waitlist — the caller's own, and the ranges waited for on the listings the caller
 * may see. Every route is scoped to the session by the API, so both reads are personal
 * and never cached — the reason `notificationsApi` gives.
 */
export const waitlistApi = {
  /** Answered whole: the API caps how many ranges one account may wait for. */
  mine: (): Promise<WaitlistEntry[]> =>
    apiRequest({
      method: "GET",
      path: "/waitlist",
      schema: waitlistSchema,
      read: { cache: "no-store" },
    }),

  /** A host's listings, or every listing for an admin — paged, see `waitlistDemandPageSchema`. */
  demand: (query: WaitlistDemandQuery): Promise<WaitlistDemandPage> =>
    apiRequest({
      method: "GET",
      path: `/waitlist/demand${queryString(query)}`,
      schema: waitlistDemandPageSchema,
      read: { cache: "no-store" },
    }),

  join: (input: JoinWaitlistInput): Promise<WaitlistEntry> =>
    apiRequest({
      method: "POST",
      path: "/waitlist",
      schema: waitlistEntrySchema,
      body: input,
    }),

  leave: (id: string): Promise<void> =>
    apiRequest({
      method: "DELETE",
      path: `/waitlist/${encodeURIComponent(id)}`,
      schema: z.void(),
    }),
};
