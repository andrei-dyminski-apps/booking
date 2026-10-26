import { Test } from "@nestjs/testing";
import { HostAccountStatus, Role } from "@repo/contracts";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { PayoutService } from "../application/payout.service";
import { PayoutAccountController } from "./payout-account.controller";

const host: AuthenticatedUser = {
  id: "6d0f2c1e-1a2b-4c3d-8e5f-9a0b1c2d3e4f",
  email: "host@example.com",
  role: Role.USER,
};

/**
 * No route of this controller names an account: what has to hold is that each one asks
 * about the caller's and nobody else's. The rules behind the answer are the service spec's.
 */
describe("PayoutAccountController", () => {
  let controller: PayoutAccountController;
  const askedFor: string[] = [];

  beforeEach(async () => {
    askedFor.length = 0;

    const moduleRef = await Test.createTestingModule({
      controllers: [PayoutAccountController],
      providers: [
        {
          provide: PayoutService,
          useValue: {
            account: (user: AuthenticatedUser) => {
              askedFor.push(user.id);

              return Promise.resolve({ status: HostAccountStatus.ENABLED });
            },
            refresh: (user: AuthenticatedUser) => {
              askedFor.push(user.id);

              return Promise.resolve({ status: HostAccountStatus.ENABLED });
            },
            session: (user: AuthenticatedUser) => {
              askedFor.push(user.id);

              return Promise.resolve({ clientSecret: "acct_session_secret" });
            },
          },
        },
      ],
    }).compile();

    controller = moduleRef.get(PayoutAccountController);
  });

  it("answers, refreshes and opens a session for the caller's own account", async () => {
    await expect(controller.account(host)).resolves.toEqual({
      status: HostAccountStatus.ENABLED,
    });
    await expect(controller.refresh(host)).resolves.toEqual({
      status: HostAccountStatus.ENABLED,
    });
    await expect(controller.session(host)).resolves.toEqual({
      clientSecret: "acct_session_secret",
    });
    expect(askedFor).toEqual([host.id, host.id, host.id]);
  });
});
