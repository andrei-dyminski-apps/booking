import { request } from "@playwright/test";
import { READER_TIME_ZONE } from "./support/demo";
import {
  LIVE_GUEST_JOINED_ENV,
  LIVE_ORIGIN,
  LIVE_READY_ENV,
  LIVE_STOPPED_ENV,
  LIVE_STOPPED_NOTICE,
} from "./live";
import { joinedOn, liveSession, sweep } from "./live-demo";
import { startPace } from "./pace";

/**
 * Before the live target's scenarios: is the demo up, are the suite's two accounts there
 * and theirs, and is what a run that died left behind cleared away.
 *
 * A stopped demo is not a failure: Railway's edge answers the API's address itself, a
 * `404` marked `x-railway-fallback`, which the frontend's BFF passes on. The run then ends
 * with a notice and every scenario skipped. A demo that is up and answers its health check
 * any other way — a `502` from a BFF that cannot reach the API, a `503` naming a database
 * that is down — fails the run.
 */
export default async function liveSetup(): Promise<void> {
  startPace();

  const probe = await request.newContext({ baseURL: LIVE_ORIGIN });

  try {
    const health = await probe.get("/api/health");

    if (
      health.status() === 404 &&
      health.headers()["x-railway-fallback"] === "true"
    ) {
      process.env[LIVE_STOPPED_ENV] = "1";
      console.log(LIVE_STOPPED_NOTICE);
      if (process.env.GITHUB_ACTIONS === "true") {
        console.log(`::notice title=Live demo stopped::${LIVE_STOPPED_NOTICE}`);
      }

      return;
    }

    if (!health.ok()) {
      throw new Error(
        `The live demo answers its health check ${String(health.status())}: ${await health.text()}`,
      );
    }
  } finally {
    await probe.dispose();
  }

  const guest = await liveSession("guest");
  const host = await liveSession("host").catch(async (error: unknown) => {
    await guest.dispose();
    throw error;
  });

  try {
    process.env[LIVE_GUEST_JOINED_ENV] = await joinedOn(
      guest,
      READER_TIME_ZONE,
    );
    await sweep(guest, host);
  } finally {
    await guest.dispose();
    await host.dispose();
  }

  process.env[LIVE_READY_ENV] = "1";
}
