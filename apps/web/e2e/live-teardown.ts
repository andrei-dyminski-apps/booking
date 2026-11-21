import { liveReady, liveStopped } from "./live";
import { liveSession, sweep } from "./live-demo";

/**
 * After the live target's scenarios: the stays the run made are cancelled and its listings
 * retired (`sweep`), so the demo is left as the run found it, as far as the application
 * allows. Nothing is done after a setup that did not go through (`liveReady`): no scenario
 * ran, and its error is the run's to report.
 */
export default async function liveTeardown(): Promise<void> {
  if (liveStopped() || !liveReady()) return;

  const guest = await liveSession("guest");

  try {
    const host = await liveSession("host");

    try {
      await sweep(guest, host);
    } finally {
      await host.dispose();
    }
  } finally {
    await guest.dispose();
  }
}
