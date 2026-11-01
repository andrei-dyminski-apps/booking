import type {
  FailedPaymentEventPage,
  RefundFailurePage,
  StuckStayPage,
} from "@repo/contracts";
import {
  bookingsApi,
  pageOrNullOnStaleCursor,
  paymentEventsApi,
  refundFailuresApi,
  type ReadOptions,
} from "#shared/api";
import type { SetAsideView } from "../lib/payments-search";

/**
 * Never cached, for the reason the users' read gives: only an admin's session may read any
 * of it, and the Data Cache is shared by URL between visitors.
 */
const SET_ASIDE_READ: ReadOptions = { cache: "no-store" };

/** The page of whichever list is on the screen, tagged with it so the screen can draw it. */
export type SetAsidePage =
  | { list: "events"; page: FailedPaymentEventPage }
  | { list: "bounced"; page: RefundFailurePage }
  | { list: "stuck-refunds" | "stuck-payouts"; page: StuckStayPage };

/** One page of the list the view names, or `null` for a cursor the API will not read. */
export async function readSetAsidePage(
  view: SetAsideView,
): Promise<SetAsidePage | null> {
  const { cursor } = view.query;

  switch (view.list) {
    case "events": {
      const page = await pageOrNullOnStaleCursor(
        () => paymentEventsApi.failed(view.query, SET_ASIDE_READ),
        cursor,
      );

      return page === null ? null : { list: view.list, page };
    }
    case "bounced": {
      const page = await pageOrNullOnStaleCursor(
        () => refundFailuresApi.page(view.query, SET_ASIDE_READ),
        cursor,
      );

      return page === null ? null : { list: view.list, page };
    }
    case "stuck-refunds":
    case "stuck-payouts": {
      const page = await pageOrNullOnStaleCursor(
        () => bookingsApi.stuck(view.query, SET_ASIDE_READ),
        cursor,
      );

      return page === null ? null : { list: view.list, page };
    }
  }
}
