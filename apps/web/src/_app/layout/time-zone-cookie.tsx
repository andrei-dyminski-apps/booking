"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TIME_ZONE_COOKIE, TIME_ZONE_COOKIE_MAX_AGE } from "#shared/config";
import { browserTimeZone } from "#shared/lib";

/**
 * Writes the browser's zone into the cookie a server render states an account's moments by
 * (`readerTimeZone`), whenever it is missing or differs — a first visit, a laptop carried
 * across a border. A personal page is drawn again once it lands, so a first visit reads its
 * notices on its own clock after one refresh rather than on the next navigation; a stranger
 * is shown no such moment, and nothing is redrawn for them.
 *
 * Rendered by the shell on every page, since the cookie has to be in place before the first
 * personal one is asked for. It writes nothing when the value is already there, so React's
 * Strict Mode running the effect twice costs one refresh at most.
 */
export const TimeZoneCookie = ({ signedIn }: { signedIn: boolean }) => {
  const router = useRouter();

  useEffect(() => {
    const zone = browserTimeZone();

    if (storedZone() === zone) return;

    const secure = window.location.protocol === "https:" ? "; Secure" : "";

    document.cookie = `${TIME_ZONE_COOKIE}=${zone}; Path=/; Max-Age=${TIME_ZONE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;

    if (signedIn) router.refresh();
  }, [signedIn, router]);

  return null;
};

function storedZone(): string | undefined {
  const prefix = `${TIME_ZONE_COOKIE}=`;

  return document.cookie
    .split("; ")
    .find((pair) => pair.startsWith(prefix))
    ?.slice(prefix.length);
}
