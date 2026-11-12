"use client";

import { useEffect, useState } from "react";
import { differenceInMilliseconds, parseISO } from "date-fns";
import { countOf, formatMomentIn } from "#shared/lib";

const MINUTE_MS = 60_000;

/**
 * A hold's deadline on the reader's clock, and how long is left before it — what it asks of
 * the guest is to pay now, so the minutes matter more than the time. The stay's page and the
 * list of stays both draw it.
 *
 * The count starts from the server's `now`, so the render and the hydration agree, and then
 * follows the browser's clock, moving on each time a whole minute is gone — so a clock set
 * wrong shows a count off by as much. It is only the count: the sweep lets the nights go
 * by the API's clock, whatever the screen said.
 */
export const HoldDeadline = ({
  expiresAt,
  now,
  readerTimeZone,
}: {
  expiresAt: string;
  /** The server's clock at the render. */
  now: string;
  readerTimeZone: string;
}) => {
  const [left, setLeft] = useState(() => msBetween(now, expiresAt));

  useEffect(() => {
    if (left === 0) return;

    const remaining = msBetween(new Date().toISOString(), expiresAt);
    // At once when the browser's clock already says otherwise — a render older than it looks,
    // out of the router's cache on Back — and otherwise just past the next whole minute gone,
    // so "3 minutes left" turns into "2" when it should.
    const timer = setTimeout(
      () => setLeft(msBetween(new Date().toISOString(), expiresAt)),
      minutesLeft(remaining) !== minutesLeft(left)
        ? 0
        : (remaining % MINUTE_MS) + 1,
    );

    return () => clearTimeout(timer);
  }, [expiresAt, left]);

  return (
    <>
      {formatMomentIn(expiresAt, readerTimeZone)}{" "}
      <span className="whitespace-nowrap">({minutesLeft(left)})</span>
    </>
  );
};

function msBetween(now: string, deadline: string): number {
  return Math.max(
    differenceInMilliseconds(parseISO(deadline), parseISO(now)),
    0,
  );
}

function minutesLeft(ms: number): string {
  if (ms <= 0) return "no time left";

  if (ms < MINUTE_MS) return "less than a minute left";

  return `${countOf(Math.floor(ms / MINUTE_MS), "minute")} left`;
}
