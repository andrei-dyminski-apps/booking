import { Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  MAIL_ENQUEUE_TIMEOUT_MS,
  MAIL_PRODUCER,
  MailQueue,
} from "./mail.queue";

describe("MailQueue", () => {
  it("reports Redis as unavailable when a command stalls past the deadline", async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailQueue,
        {
          provide: MAIL_PRODUCER,
          useValue: {
            on: jest.fn(),
            getJobState: jest.fn().mockResolvedValue("unknown"),
            add: jest.fn(() => new Promise(() => undefined)),
            disconnect: jest.fn(),
          },
        },
      ],
    }).compile();
    const queue = moduleRef.get(MailQueue);
    const log = jest
      .spyOn(Logger.prototype, "warn")
      .mockImplementation(() => undefined);
    jest.useFakeTimers();
    try {
      const queued = expect(
        queue.schedule({
          id: "confirmation",
          kind: "confirm",
          userId: "recipient",
          createdAt: new Date(),
          availableAt: new Date(),
          deliveryRound: 0,
        }),
      ).resolves.toBe("unavailable");
      await jest.advanceTimersByTimeAsync(MAIL_ENQUEUE_TIMEOUT_MS);
      await queued;
    } finally {
      jest.useRealTimers();
      log.mockRestore();
      await moduleRef.close();
    }
  });
});
