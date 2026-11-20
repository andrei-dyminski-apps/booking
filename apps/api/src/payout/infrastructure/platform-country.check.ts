import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import Stripe from "stripe";
import { STRIPE_CLIENT } from "../../payment/infrastructure/stripe";
import { PAYOUT_PLATFORM_COUNTRY } from "./payout-countries.snapshot";

/**
 * The payout countries are a snapshot read for a platform in `PAYOUT_PLATFORM_COUNTRY`, and
 * nothing at runtime reads them from Stripe. A deployment whose key belongs to an account
 * elsewhere would offer countries that platform cannot transfer to: a host would onboard
 * and never be paid. So a deployment reads its own account once at boot — one small read,
 * not the country specs — and refuses to start on a mismatch, the way a missing secret
 * stops it. A Stripe that cannot be reached at that moment is logged and the boot goes on:
 * the key is no less right for Stripe being slow, and the rest of the API does not wait on
 * it. Outside production it is not asked: the hermetic browser suite plays Stripe with a
 * stand-in, and a developer's own stack is the probe's to check. The real-Stripe browser
 * suite runs the API in production mode against the sandbox of the root `.env`, so it is
 * asked there too, and on purpose: its payouts scenario opens accounts from this snapshot,
 * which says nothing true of a platform elsewhere.
 */
@Injectable()
export class PlatformCountryCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformCountryCheck.name);

  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: Stripe) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;

    await checkPlatformCountry(
      this.stripe,
      PAYOUT_PLATFORM_COUNTRY,
      this.logger,
    );
  }
}

/** Throws when the key's account is in another country; an unreadable account only warns. */
export async function checkPlatformCountry(
  stripe: Stripe,
  expected: string,
  logger: Pick<Logger, "warn">,
): Promise<void> {
  let country: string | undefined;

  try {
    ({ country } = await stripe.accounts.retrieveCurrent());
  } catch (error) {
    logger.warn(
      `Could not read the platform's Stripe account to check its country against the payout snapshot's ${expected}: ${String(error)}`,
    );

    return;
  }

  if (country !== expected) {
    throw new Error(
      `STRIPE_SECRET_KEY belongs to a platform in ${country ?? "no country"}, while the payout countries are a snapshot for one in ${expected} — run stripe:sync-countries with this key, or use the key of the account in ${expected}`,
    );
  }
}
