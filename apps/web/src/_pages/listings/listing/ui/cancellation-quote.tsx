"use client";

import { useEffect, useState } from "react";
import { addMilliseconds, differenceInMilliseconds, parseISO } from "date-fns";
import { useWatch, type Control } from "react-hook-form";
import {
  refundSchedule,
  type CancellationPolicy,
  type CreateBookingInput,
} from "@repo/contracts";
import { RefundScheduleList } from "#entities/booking";
import { isDay } from "#shared/lib";

/** Often enough that a window is not shown for long after it closed: they end on minutes. */
const CLOCK_TICK_MS = 30_000;

/**
 * What cancelling the stay being chosen would give back, and until when — the listing's
 * policy dated for the check-in typed into the form. The moment the hold would be taken is
 * when the form is sent, not when the page was rendered: the API freezes the same policy
 * onto the stay and measures from its `createdAt`, so a quote frozen at the render would
 * keep promising a grace period, or a window, that closed while the page stood open. It
 * moves on with the clock instead (`useHoldMoment`); what is left is the few seconds between
 * a tick and the press.
 *
 * It subscribes to the check-in on its own, as `StayQuote` does.
 */
export const CancellationQuote = ({
  control,
  policy,
  now,
}: {
  control: Control<CreateBookingInput>;
  policy: CancellationPolicy;
  /** The server's clock at the render, handed down like `today()`. */
  now: string;
}) => {
  const from = useWatch({ control, name: "from" });
  const moment = useHoldMoment(now);

  if (!isDay(from)) return null;

  // Named, or the lines under the dates read as a list of nobody knows what.
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">If you cancel this stay</h3>
      <RefundScheduleList
        schedule={refundSchedule({
          from,
          createdAt: moment,
          cancellationPolicy: policy,
        })}
      />
    </div>
  );
};

/**
 * How far the server's clock is ahead of this browser's, by the render it was measured
 * for. Measured once per render rather than once per mount: going back to the page hands
 * the router's cached payload over again, `now` and all, and measured at that mount the
 * minutes the page sat in the cache would count as the server's lead, so the quote would
 * lag behind by them for as long as the page stays open.
 *
 * Only the newest renders are kept — a map with no bound would grow by one entry per
 * listing opened for as long as the tab lives — and a `Map` iterates in insertion order,
 * so the first key is the oldest. The router keeps far fewer pages than this.
 */
const serverLeads = new Map<string, number>();

const SERVER_LEADS_KEPT = 50;

function serverLead(now: string): number {
  const measured = serverLeads.get(now);

  if (measured !== undefined) return measured;

  const lead = differenceInMilliseconds(parseISO(now), Date.now());

  serverLeads.set(now, lead);

  if (serverLeads.size > SERVER_LEADS_KEPT) {
    const [oldest] = serverLeads.keys();

    if (oldest !== undefined) serverLeads.delete(oldest);
  }

  return lead;
}

/**
 * The server's moment now: the browser's clock plus the lead the server had over it when
 * this render arrived. The render's own moment first, so the hydrated markup is the
 * server's; the browser's clock only measures the time elapsed, so one set wrong does not
 * move the windows — a clock changed while the page is open does, until the next render.
 * Moved on at the mount too, which is what a page restored from the router's cache needs.
 */
function useHoldMoment(now: string): string {
  const [moment, setMoment] = useState(now);

  useEffect(() => {
    const lead = serverLead(now);
    const tick = () => {
      setMoment(addMilliseconds(Date.now(), lead).toISOString());
    };

    tick();

    const timer = setInterval(tick, CLOCK_TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [now]);

  return moment;
}
