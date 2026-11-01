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
  SET_ASIDE_FILTERS_OF,
  SET_ASIDE_LISTS,
  setAsideHref,
  type SetAsideFilterKey,
  type SetAsideList,
} from "#shared/config";
import {
  dayLabelOrAny,
  searchParamsHref,
  shortId,
  singleParam,
  toFieldErrors,
  type FieldErrors,
} from "#shared/lib";

/*
 * The four lists of what the money paths set aside, one per tab — `SET_ASIDE_LISTS` in
 * `shared/config`: the provider's events the worker gave up on, the refunds a guest's bank
 * sent back, and the stays whose owed refund or host payout stopped retrying. Each is a
 * different route of the API with its own cursor, so a tab is a different list rather than
 * a filter of one; inside a tab the filters of its query narrow it, the stays screen's way.
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

/**
 * What the boxes of the filter form hold — text, because that is what a URL carries. Every
 * key is here whatever the tab, and the ones its list does not read are blank: a refund's
 * id typed on the events tab names nothing there.
 */
export type FilterValues = Record<SetAsideFilterKey, string>;

/** Where on the screen a link is written from: the tab, its filters and its page. */
export type PaymentsPlace = {
  list: SetAsideList;
  values: FilterValues;
  cursor: string | undefined;
};

export type PaymentsSearch = PaymentsPlace & {
  /** The question to put to the API, or `null` when the URL holds one it cannot answer. */
  view: SetAsideView | null;
  errors: FieldErrors;
  /** The address this view belongs at, or `null` when the URL already spells it. */
  canonical: string | null;
};

/**
 * The URL of the screen as it arrives. `list` and `status` only pick a tab, so a value this
 * screen does not know lands on the default the way an unknown `?side=` does on the stays,
 * rather than as a refusal. The filters are the list's query, parsed by the schema that
 * validates the same query string in Nest, and what it refuses is shown under the box it
 * belongs to. A filter of another tab is dropped. The cursor is the API's to judge: a typed
 * one is a `400`, which the page shows as a lost place.
 *
 * One view, one address — the rule every list here keeps, so a tab's link, a notice's link
 * and the address it is read at are the same string.
 */
export function readPaymentsSearch(
  params: Record<string, string | string[] | undefined>,
): PaymentsSearch {
  const list = listOf(singleParam(params.list));
  const values = emptyValues();

  for (const key of SET_ASIDE_FILTERS_OF[list]) {
    values[key] =
      key === "status"
        ? statusParam(statusOf(singleParam(params.status)))
        : singleParam(params[key]);
  }

  const cursorParam = singleParam(params.cursor);
  const cursor = cursorParam === "" ? undefined : cursorParam;
  const place = { list, values, cursor };

  const href = viewHref(place);
  const canonical =
    href === searchParamsHref(ROUTES.adminPayments, params) ? null : href;

  const parsed = viewOf(list, values, cursor);

  return parsed.success
    ? { ...place, view: parsed.view, errors: {}, canonical }
    : { ...place, view: null, errors: parsed.errors, canonical };
}

/** The four lists as tabs, each opened at its first page with nothing filtered. */
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

/**
 * The two halves of the bounced refunds: what still waits for a person, and the record.
 * The filters go along — a refund a notice named may have been resolved since, and the
 * other half is where it is.
 */
export function statusTabs(values: FilterValues): Array<{
  status: RefundFailureStatusName;
  label: string;
  href: string;
  current: boolean;
}> {
  const current = statusOf(values.status);

  return refundFailureStatusSchema.options.map((status) => ({
    status,
    label: STATUS_LABELS[status],
    href: setAsideHref("bounced", { ...values, status }),
    current: status === current,
  }));
}

/** The address of the view itself, its cursor included — where a sign-in returns to. */
export function viewHref({ list, values, cursor }: PaymentsPlace): string {
  return setAsideHref(list, values, cursor);
}

/** The same view with no cursor — the first page of the list on the screen. */
export function firstPageHref({ list, values }: PaymentsPlace): string {
  return setAsideHref(list, values);
}

/** The next page of the list on the screen, under the cursor its last page issued. */
export function nextPageHref(
  { list, values }: PaymentsPlace,
  cursor: string,
): string {
  return setAsideHref(list, values, cursor);
}

/** The same tab with nothing filtered — the half of the refunds is a tab, not a filter. */
export function clearedFiltersHref(
  list: SetAsideList,
  values: FilterValues,
): string {
  return setAsideHref(list, { status: values.status });
}

/** A filter as a chip: what it says, and the link that takes it off. */
export type ActiveFilter = {
  key: string;
  label: string;
  /** The same view without this filter — and without a cursor. */
  href: string;
};

/** The names of the rows the id filters name, where the page could resolve them. */
export type FilterNames = {
  listing?: string | undefined;
  guest?: string | undefined;
  host?: string | undefined;
};

/**
 * What is currently being filtered by, as chips — `status` aside, which is a tab. The two
 * ends of the window are a chip each, because the contract takes either alone. An id is
 * shown by the name of the row it names where the page resolved one; a value the contract
 * refused is shown as it was typed, so its chip can take the refusal off again.
 */
export function activeFilters(
  list: SetAsideList,
  values: FilterValues,
  names: FilterNames = {},
): ActiveFilter[] {
  const label: Record<Exclude<SetAsideFilterKey, "status">, string> = {
    eventId: `Event ${values.eventId}`,
    type: `Type has “${values.type}”`,
    refundId: `Refund ${values.refundId}`,
    paymentId: `Payment ${values.paymentId}`,
    bookingId: `Stay ${shortId(values.bookingId)}`,
    listingId: names.listing ?? `Listing ${shortId(values.listingId)}`,
    guestId: names.guest ?? `Guest ${shortId(values.guestId)}`,
    hostId: names.host ?? `Host ${shortId(values.hostId)}`,
    from: `Set aside from ${dayLabelOrAny(values.from)}`,
    to: `Set aside until ${dayLabelOrAny(values.to)}`,
  };

  return SET_ASIDE_FILTERS_OF[list].flatMap((key) =>
    key === "status" || values[key] === ""
      ? []
      : [
          {
            key,
            label: label[key],
            href: setAsideHref(list, { ...values, [key]: "" }),
          },
        ],
  );
}

function emptyValues(): FilterValues {
  return {
    status: "",
    eventId: "",
    type: "",
    refundId: "",
    paymentId: "",
    bookingId: "",
    listingId: "",
    guestId: "",
    hostId: "",
    from: "",
    to: "",
  };
}

type ParsedView =
  | { success: true; view: SetAsideView }
  | { success: false; errors: FieldErrors };

/** Each list's query out of the values its tab reads, the cursor after them. */
function viewOf(
  list: SetAsideList,
  values: FilterValues,
  cursor: string | undefined,
): ParsedView {
  switch (list) {
    case "events": {
      const parsed = failedPaymentEventQuerySchema.safeParse({
        eventId: values.eventId,
        type: values.type,
        from: values.from,
        to: values.to,
        cursor,
      });

      return parsed.success
        ? { success: true, view: { list, query: parsed.data } }
        : { success: false, errors: toFieldErrors(parsed.error.issues) };
    }
    case "bounced": {
      const parsed = refundFailureQuerySchema.safeParse({
        status: values.status,
        refundId: values.refundId,
        paymentId: values.paymentId,
        ...stayValues(values),
        cursor,
      });

      return parsed.success
        ? { success: true, view: { list, query: parsed.data } }
        : { success: false, errors: toFieldErrors(parsed.error.issues) };
    }
    case "stuck-refunds":
    case "stuck-payouts": {
      const parsed = stuckStayQuerySchema.safeParse({
        kind: STUCK_KINDS[list],
        ...stayValues(values),
        cursor,
      });

      return parsed.success
        ? { success: true, view: { list, query: parsed.data } }
        : { success: false, errors: toFieldErrors(parsed.error.issues) };
    }
  }
}

function stayValues(values: FilterValues) {
  return {
    bookingId: values.bookingId,
    listingId: values.listingId,
    guestId: values.guestId,
    hostId: values.hostId,
    from: values.from,
    to: values.to,
  };
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

/** The open half is the default and leaves no trace in the URL. */
function statusParam(status: RefundFailureStatusName): string {
  return status === RefundFailureStatus.OPEN ? "" : status;
}
