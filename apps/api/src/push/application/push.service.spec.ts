import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import { DEFAULT_PUSH_PREFERENCES } from "@repo/contracts";
import { refusalOf } from "../../common/testing/refusal";
import { PushRepository } from "../infrastructure/push.repository";
import {
  DisabledPushGateway,
  InMemoryPushGateway,
} from "../infrastructure/web-push.gateway";
import { FakePushRepository } from "../testing/push.fakes";
import { PushGateway } from "./ports/push-gateway";
import { PushService } from "./push.service";

const ALICE = randomUUID();

const subscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/laptop",
  keys: {
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  },
};

describe("PushService", () => {
  let pushRepository: FakePushRepository;

  const serviceWith = async (gateway: PushGateway) => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PushService,
        { provide: PushRepository, useValue: pushRepository },
        { provide: PushGateway, useValue: gateway },
      ],
    }).compile();

    return moduleRef.get(PushService);
  };

  beforeEach(() => {
    pushRepository = new FakePushRepository();
  });

  it("offers the key browsers subscribe with, and stores a subscription", async () => {
    const gateway = new InMemoryPushGateway();
    const service = await serviceWith(gateway);

    expect(service.config()).toEqual({ publicKey: gateway.publicKey });
    await service.subscribe(ALICE, subscription);
    expect(pushRepository.subscriptions).toHaveLength(1);
  });

  it("refuses a subscription while push is not configured, and keeps the preferences", async () => {
    const service = await serviceWith(new DisabledPushGateway());

    expect(service.config()).toEqual({ publicKey: null });
    await expect(
      refusalOf(service.subscribe(ALICE, subscription)),
    ).resolves.toEqual({
      status: 503,
      code: "PUSH_NOT_CONFIGURED",
    });

    const preferences = { ...DEFAULT_PUSH_PREFERENCES, hourlyLimit: 5 };
    await service.savePreferences(ALICE, preferences);
    await expect(service.preferences(ALICE)).resolves.toEqual(preferences);
  });

  it("records a receipt as it is posted", async () => {
    const service = await serviceWith(new InMemoryPushGateway());
    const receipt = { id: randomUUID(), event: "clicked" as const };

    await service.recordReceipt(receipt);

    expect(pushRepository.receipts).toEqual([receipt]);
  });
});
