import { Injectable, Logger } from "@nestjs/common";
import { stillOwed, type HostFeeOverview } from "@repo/contracts";
import { writeOrRefuse } from "../../common/set-aside";
import { addCents, NO_CENTS } from "../../payment/domain/money";
import {
  WaivingAccountGoneError,
  WaivingAccountNotAdminError,
} from "../domain/payout.errors";
import type { HostFeeReader } from "../domain/payout.types";
import { HostFeeRepository } from "../infrastructure/host-fee.repository";
import {
  sessionNotFound,
  notAnAdminAnymore,
} from "../../common/session-errors";

/**
 * What hosts owe for cancelling paid stays: the overview the host's payouts screen and the
 * admin's account page read, and the admin's waiver. Withholding a fee is the payout's
 * (`PayoutService.payOut`).
 */
@Injectable()
export class HostFeeService {
  private readonly logger = new Logger(HostFeeService.name);

  constructor(private readonly hostFeeRepository: HostFeeRepository) {}

  /** Any account's — a host who has cancelled nothing gets an empty overview, not a `404`. */
  async overviewOf(
    hostId: string,
    reader: HostFeeReader,
    now = new Date(),
  ): Promise<HostFeeOverview> {
    const { fees, cancellationsInWindow } =
      await this.hostFeeRepository.overviewOf(hostId, reader, now);

    return {
      cancellationsInWindow,
      owedCents: fees.reduce(
        (total, fee) => addCents(total, stillOwed(fee)),
        NO_CENTS,
      ),
      fees,
    };
  }

  /**
   * The circumstance a policy could not foresee. What was withheld already stays withheld;
   * a fee waived or withheld in full is a `409`, one that is not there a `404`. An admin
   * whose account is gone since the token was issued is a `401`, one demoted or blocked
   * since — by a write to `users` outside the API — a `403`.
   */
  async waive(id: string, reason: string, adminId: string): Promise<void> {
    try {
      await writeOrRefuse(
        this.hostFeeRepository.waive(id, reason, adminId),
        () => this.hostFeeRepository.exists(id),
        {
          conflict: {
            code: "HOST_FEE_NOT_OWED",
            message: `The fee ${id} is not owed any more: it was waived or withheld in full`,
          },
          notFound: {
            code: "HOST_FEE_NOT_FOUND",
            message: `Fee ${id} not found`,
          },
        },
      );
    } catch (error) {
      if (error instanceof WaivingAccountGoneError) {
        throw sessionNotFound();
      }

      if (error instanceof WaivingAccountNotAdminError) {
        throw notAnAdminAnymore();
      }

      throw error;
    }

    this.logger.log(`The fee ${id} was waived by ${adminId}: ${reason}`);
  }
}
