import { Test } from "@nestjs/testing";
import { Prisma } from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AccountMailRepository } from "./account-mail.repository";

const input = {
  name: "Guest",
  email: "guest@example.com",
  passwordHash: "hash",
};

/**
 * A P2002 in the shape Prisma 7 actually produces. The columns do not arrive in the
 * `meta.target` of the versions before driver adapters — they are nested under the error
 * the adapter raised, and that shape is the one thing the translation below depends on.
 */
function uniqueViolation(
  ...fields: string[]
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "7.0.0",
    meta: {
      modelName: "User",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          kind: "UniqueConstraintViolation",
          constraint: { fields },
        },
      },
    },
  });
}

describe("AccountMailRepository", () => {
  let accountMailRepository: AccountMailRepository;
  let create: jest.Mock;

  beforeEach(async () => {
    create = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountMailRepository,
        {
          provide: PrismaService,
          useValue: {
            $transaction: (
              write: (tx: {
                user: { create: jest.Mock };
                accountMail: object;
                mailOutbox: object;
                $executeRaw: () => number;
              }) => unknown,
            ) =>
              write({
                user: { create },
                $executeRaw: () => 0,
                mailOutbox: { deleteMany: () => ({ count: 1 }) },
                accountMail: {
                  findUnique: () => ({ id: "pending", email: input.email }),
                  deleteMany: () => ({ count: 1 }),
                },
              }),
          },
        },
      ],
    }).compile();

    accountMailRepository = moduleRef.get(AccountMailRepository);
  });

  it("returns no user when the verified email was claimed concurrently", async () => {
    create.mockRejectedValue(uniqueViolation("email"));

    await expect(
      accountMailRepository.register("token", input.name, input.passwordHash),
    ).resolves.toBeNull();
  });

  it("leaves a conflict on another column alone", async () => {
    // Nothing else on the model is unique yet, so this is what the check is for: the day
    // one is added, its conflict must not reach the caller as a taken email address. It
    // also fails the moment an upgrade moves the columns somewhere else in the error —
    // the fallback would answer "email" again and nothing else would notice.
    create.mockRejectedValue(uniqueViolation("username"));

    await expect(
      accountMailRepository.register("token", input.name, input.passwordHash),
    ).rejects.toThrow();
  });

  it("counts a shape it cannot read as the email", async () => {
    // What an upgrade that moves the columns elsewhere in the error looks like. Answering
    // a duplicate registration with a 500 would be worse than naming the only unique
    // column the model has — and the test above is what keeps that fallback from being
    // reached by a conflict the schema can read.
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.0.0",
        meta: { modelName: "User" },
      }),
    );

    await expect(
      accountMailRepository.register("token", input.name, input.passwordHash),
    ).resolves.toBeNull();
  });

  it("does not dress up a failure that is not a unique violation", async () => {
    create.mockRejectedValue(new Error("the connection went away"));

    await expect(
      accountMailRepository.register("token", input.name, input.passwordHash),
    ).rejects.toThrow();
  });
});
