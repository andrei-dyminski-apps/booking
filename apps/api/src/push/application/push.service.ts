import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import type {
  PushConfig,
  PushMaintenance,
  PushPreferences,
  PushPreferencesPatch,
  PushReceipt,
  PushRegistration,
  PushSubscriptionStatus,
} from "@repo/contracts";
import { apiException } from "../../common/api-exception";
import { sessionNotFound } from "../../common/session-errors";
import { isPushPublicKey } from "../domain/push-key";
import {
  InactivePushAccountError,
  PushSubscriptionReuseError,
  PushRepository,
} from "../infrastructure/push.repository";
import { PushGateway } from "./ports/push-gateway";

/**
 * Web Push as the routes see it: the browsers that asked to be told about an account's
 * notices and messages while none of its tabs is open, how the account wants to be told,
 * and the receipts the service worker posts back. Sending is `PushDispatcher`'s, behind the
 * outbox: the notices and the messages write their tasks themselves (`recordPushTask`), so
 * nothing here is called by another module.
 */
@Injectable()
export class PushService {
  constructor(
    private readonly pushRepository: PushRepository,
    private readonly pushGateway: PushGateway,
  ) {}

  /**
   * A tab names the account it was rendered for; a session that has changed account since
   * then must not read or change the other account's push from it.
   */
  requireAccount(userId: string, expectedAccountId: string | undefined): void {
    if (expectedAccountId !== undefined && expectedAccountId !== userId) {
      throw apiException(
        ConflictException,
        "PUSH_ACCOUNT_CHANGED",
        "Your account has changed. Reload the page and try again.",
      );
    }
  }

  config(): PushConfig {
    return { publicKey: this.pushGateway.publicKey };
  }

  async subscribe(
    userId: string,
    input: PushRegistration,
    previousAuth?: string,
  ): Promise<void> {
    if (this.pushGateway.publicKey === null) {
      throw apiException(
        ServiceUnavailableException,
        "PUSH_NOT_CONFIGURED",
        "Push notifications are not configured",
      );
    }

    if (!isPushPublicKey(input.keys.p256dh)) {
      throw apiException(
        BadRequestException,
        "PUSH_KEY_INVALID",
        "Invalid push public key",
      );
    }

    try {
      await writeForActiveAccount(
        this.pushRepository.save(userId, input, previousAuth),
      );
    } catch (error) {
      if (error instanceof PushSubscriptionReuseError) {
        throw apiException(
          ConflictException,
          "PUSH_SUBSCRIPTION_REUSE",
          "Create a new browser subscription",
        );
      }
      throw error;
    }
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.pushRepository.remove(userId, endpoint);
  }

  async maintain({
    accountId,
    endpoint,
    auth,
    replacement,
  }: PushMaintenance): Promise<void> {
    if (replacement === undefined) {
      await this.pushRepository.remove(accountId, endpoint, auth);
      return;
    }

    await this.subscribe(
      accountId,
      { ...replacement, previousEndpoint: endpoint },
      auth,
    );
  }

  async subscriptionStatus(
    userId: string,
    endpoint: string,
  ): Promise<PushSubscriptionStatus> {
    return {
      registered: await this.pushRepository.hasSubscription(userId, endpoint),
    };
  }

  preferences(userId: string): Promise<PushPreferences> {
    return this.pushRepository.preferencesOf(userId);
  }

  /** Saved whether or not push is configured: they are the account's, and wait for it. */
  async savePreferences(
    userId: string,
    preferences: PushPreferencesPatch,
  ): Promise<void> {
    await writeForActiveAccount(
      this.pushRepository.savePreferences(userId, preferences),
    );
  }

  /**
   * Whatever the id names — an unknown one changes nothing and is answered the same, so the
   * route says nothing about which ids exist.
   */
  async recordReceipt(receipt: PushReceipt): Promise<void> {
    await this.pushRepository.recordReceipt(receipt, new Date());
  }
}

async function writeForActiveAccount(write: Promise<void>): Promise<void> {
  try {
    await write;
  } catch (error) {
    if (error instanceof InactivePushAccountError) throw sessionNotFound();

    throw error;
  }
}
