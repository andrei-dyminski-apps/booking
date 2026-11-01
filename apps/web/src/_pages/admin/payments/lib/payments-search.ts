import {
  failedPaymentEventQuerySchema,
  refundFailureQuerySchema,
  RefundFailureStatus,
  refundFailureStatusSchema,
  StuckKind,
  stuckStayQuerySchema,
  type FailedPaymentEventQuery,
  type RefundFailureQuery,
  type RefundFailureStatus as RefundFailureStatusName,
  type StuckKind as StuckKindName,
  type StuckStayQuery,
} from "@repo/contracts";
import {
  DEFAULT_SET_ASIDE_LIST,
  ROUTES,
  SET_ASIDE_LISTS,
  setAsideHref,
  type SetAsideList,
} from "#shared/config";
import { searchParamsHref, singleParam } from "#shared/lib";

/*
 * The four lists of what the money paths set aside, one per tab — `SET_ASIDE_LISTS` in
 * `shared/config`: the provider's events the worker gave up on, the refunds a guest's bank
 * sent back, and the stays whose owed refund or host payout stopped retrying. Each is a
 * different route of the API with its own cursor, so a tab is a different list rather than
 * a filter of one.
 */

export const LIST_LABELS: Record<SetAsideList, string> = {
  events: "Payment events",
  bounced: "Bounced refunds",
  "stuck-refunds": "Stuck refunds",
  "stuck-payouts": "Stuck payouts",
};

const STUCK_KINDS: Record<"stuck-refunds" | "stuck-payouts", StuckKindName> = {
  "stuck-refunds": StuckKind.refund,
  "stuck-payouts": StuckKind.payout,
};

/** Which of the four is on the screen, and the question to put to the API for it. */
export type SetAsideView =
  | { list: "events"; query: FailedPaymentEventQuery }
  | { list: "bounced"; query: RefundFailureQuery }
  | { list: "stuck-refunds" | "stuck-payouts"; query: StuckStayQuery };

export type PaymentsSearch = {
  view: SetAsideView;
  /** The address this view belongs at, or `null` when the URL already spells it. */
  canonical: string | null;
};

/**
 * The URL of the screen as it arrives. There is nothing typed into a box here — `list` and
 * `status` only pick a tab, so a value this screen does not know lands on the default the
 * way an unknown `?side=` does on the stays, rather than as a refusal. `status` belongs to
 * the bounced refunds alone and is dropped from every other tab. The cursor is the API's
 * to judge: a typed one is a `400`, which the page shows as a lost place.
 *
 * One view, one address — the rule every list here keeps, so a tab's link and the address
 * it is read at are the same string.
 */
export function readPaymentsSearch(
  params: Record<string, string | string[] | undefined>,
): PaymentsSearch {
  const list = listOf(singleParam(params.list));
  const status = statusOf(singleParam(params.status));
  const cursorParam = singleParam(params.cursor);
  const cursor = cursorParam === "" ? undefined : cursorParam;

  const view = viewOf(list, status, cursor);
  const href = setAsideHref(list, status, cursor);
  const canonical =
    href === searchParamsHref(ROUTES.adminPayments, params) ? null : href;

  return { view, canonical };
}

/** The four lists as tabs, each opened at its first page. */
export function listTabs(current: SetAsideList): Array<{
  list: SetAsideList;
  label: string;
  href: string;
  current: boolean;
}> {
  return SET_ASIDE_LISTS.map((list) => ({
    list,
    label: LIST_LABELS[list],
    href: setAsideHref(list),
    current: list === current,
  }));
}

const STATUS_LABELS: Record<RefundFailureStatusName, string> = {
  [RefundFailureStatus.OPEN]: "Open",
  [RefundFailureStatus.RESOLVED]: "Resolved",
};

/** The two halves of the bounced refunds: what still waits for a person, and the record. */
export function statusTabs(current: RefundFailureStatusName): Array<{
  status: RefundFailureStatusName;
  label: string;
  href: string;
  current: boolean;
}> {
  return refundFailureStatusSchema.options.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    href: setAsideHref("bounced", status),
    current: status === current,
  }));
}

/** The address of the view itself, its cursor included — where a sign-in returns to. */
export function viewHref(view: SetAsideView): string {
  return setAsideHref(view.list, statusOfView(view), view.query.cursor);
}

/** The same view with no cursor — the first page of the list on the screen. */
export function firstPageHref(view: SetAsideView): string {
  return setAsideHref(view.list, statusOfView(view));
}

/** The next page of the list on the screen, under the cursor its last page issued. */
export function nextPageHref(view: SetAsideView, cursor: string): string {
  return setAsideHref(view.list, statusOfView(view), cursor);
}

function statusOfView(view: SetAsideView): RefundFailureStatusName | undefined {
  return view.list === "bounced" ? view.query.status : undefined;
}

function viewOf(
  list: SetAsideList,
  status: RefundFailureStatusName,
  cursor: string | undefined,
): SetAsideView {
  switch (list) {
    case "events":
      return { list, query: failedPaymentEventQuerySchema.parse({ cursor }) };
    case "bounced":
      return {
        list,
        query: refundFailureQuerySchema.parse({ status, cursor }),
      };
    case "stuck-refunds":
    case "stuck-payouts":
      return {
        list,
        query: stuckStayQuerySchema.parse({ kind: STUCK_KINDS[list], cursor }),
      };
  }
}

function listOf(value: string): SetAsideList {
  return (
    SET_ASIDE_LISTS.find((list) => list === value) ?? DEFAULT_SET_ASIDE_LIST
  );
}

function statusOf(value: string): RefundFailureStatusName {
  const parsed = refundFailureStatusSchema.safeParse(value);

  return parsed.success ? parsed.data : RefundFailureStatus.OPEN;
}
