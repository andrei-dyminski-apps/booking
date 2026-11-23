import { Test } from "@nestjs/testing";
import {
  Role,
  type ManagedUser,
  type ManagedUserDetail,
  type User,
} from "@repo/contracts";
import * as argon2 from "argon2";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { Page } from "../common/paging";
import type { PublicOf } from "../common/testing/public-of.fakes";
import { refusalOf } from "../common/testing/refusal";
import { UserRepository, type UserCredentials } from "../user/user.repository";
import {
  AccountGoneError,
  AccountRepository,
  LastAdminError,
  OpenMattersError,
} from "./account.repository";
import { AccountService } from "./account.service";

const PASSWORD = "password123";

const guest: AuthenticatedUser = {
  id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  email: "guest@example.com",
  role: Role.USER,
};

/** The one read the erasure makes of `users` before it: the hash, or no session. */
class FakeUserRepository implements PublicOf<UserRepository> {
  readonly hashes = new Map<string, string>();

  findPasswordHashById(id: string): Promise<string | null> {
    return Promise.resolve(this.hashes.get(id) ?? null);
  }

  // The rest is the session's and the admin's. Nothing here calls it.
  create(): Promise<User> {
    return Promise.reject(new Error("AccountService registers nobody"));
  }

  findByEmail(): Promise<UserCredentials | null> {
    return Promise.reject(new Error("AccountService signs nobody in"));
  }

  findActiveById(): Promise<User | null> {
    return Promise.reject(new Error("AccountService reads no session"));
  }

  findDetailById(): Promise<ManagedUserDetail | null> {
    return Promise.reject(new Error("AccountService reads no details"));
  }

  findPage(): Promise<Page<ManagedUser>> {
    return Promise.reject(new Error("AccountService pages no users"));
  }

  update(): Promise<ManagedUser | null> {
    return Promise.reject(new Error("AccountService blocks nobody"));
  }
}

/**
 * The erasure, as far as the service sees it: done, or refused for a reason the repository
 * decided under its locks. What the reasons are is the e2e spec's half.
 */
class FakeAccountRepository implements PublicOf<AccountRepository> {
  readonly erased = new Map<string, string>();
  refusal: Error | null = null;

  erase(userId: string, placeholderHash: string): Promise<void> {
    if (this.refusal !== null) return Promise.reject(this.refusal);

    this.erased.set(userId, placeholderHash);

    return Promise.resolve();
  }
}

describe("AccountService", () => {
  let service: AccountService;
  let userRepository: FakeUserRepository;
  let accountRepository: FakeAccountRepository;

  beforeEach(async () => {
    userRepository = new FakeUserRepository();
    accountRepository = new FakeAccountRepository();
    userRepository.hashes.set(
      guest.id,
      await argon2.hash(PASSWORD, { type: argon2.argon2id }),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: UserRepository, useValue: userRepository },
        { provide: AccountRepository, useValue: accountRepository },
      ],
    }).compile();

    service = moduleRef.get(AccountService);
  });

  it("erases the account behind the session once the password is typed again", async () => {
    await service.deleteOwn(guest, { password: PASSWORD });

    const placeholder = accountRepository.erased.get(guest.id);

    expect(placeholder).toBeDefined();
    // A hash nothing matches — the old password least of all.
    expect(await argon2.verify(placeholder ?? "", PASSWORD)).toBe(false);
  });

  it("refuses a wrong password with a 403, not the 401 that would end the session", async () => {
    expect(
      await refusalOf(service.deleteOwn(guest, { password: "not-it" })),
    ).toEqual({ status: 403, code: "PASSWORD_INCORRECT" });
    expect(accountRepository.erased.size).toBe(0);
  });

  it("answers an account with no session left — gone, blocked, erased — as an ended session", async () => {
    userRepository.hashes.clear();

    expect(
      await refusalOf(service.deleteOwn(guest, { password: PASSWORD })),
    ).toEqual({ status: 401, code: "SESSION_NOT_FOUND" });
  });

  it("names the first matter still open and lists every one of them with its sides", async () => {
    accountRepository.refusal = new OpenMattersError(guest.id, {
      open: ["ACCOUNT_HAS_OPEN_STAY", "ACCOUNT_AWAITS_REFUND"],
      asGuest: ["ACCOUNT_AWAITS_REFUND"],
      asHost: ["ACCOUNT_HAS_OPEN_STAY"],
    });

    expect(
      await refusalOf(service.deleteOwn(guest, { password: PASSWORD })),
    ).toEqual({
      status: 409,
      code: "ACCOUNT_HAS_OPEN_STAY",
      params: {
        open: ["ACCOUNT_HAS_OPEN_STAY", "ACCOUNT_AWAITS_REFUND"],
        asGuest: ["ACCOUNT_AWAITS_REFUND"],
        asHost: ["ACCOUNT_HAS_OPEN_STAY"],
      },
    });
  });

  it("refuses the last admin", async () => {
    accountRepository.refusal = new LastAdminError(guest.id);

    expect(
      await refusalOf(service.deleteOwn(guest, { password: PASSWORD })),
    ).toEqual({ status: 409, code: "LAST_ADMIN_CANNOT_DELETE" });
  });

  it("answers an account erased or blocked between the password and the erasure as an ended session", async () => {
    accountRepository.refusal = new AccountGoneError(guest.id);

    expect(
      await refusalOf(service.deleteOwn(guest, { password: PASSWORD })),
    ).toEqual({ status: 401, code: "SESSION_NOT_FOUND" });
  });
});
