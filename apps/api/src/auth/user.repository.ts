import { Injectable } from "@nestjs/common";
import type { User } from "@repo/contracts";
import { z } from "zod";
import { type Prisma, type User as UserRow } from "../generated/prisma/client";
import {
  isPrismaError,
  PrismaErrorCode,
  violatedConstraint,
} from "../prisma/prisma.errors";
import { PrismaService } from "../prisma/prisma.service";

/**
 * What `create` throws instead of letting a Prisma error code reach the service. Which
 * driver reports a unique violation, and under which code, is exactly the knowledge this
 * layer exists to keep on its own side.
 */
export class EmailAlreadyRegisteredError extends Error {
  constructor(email: string) {
    super(`Email ${email} is already registered`);
    this.name = "EmailAlreadyRegisteredError";
  }
}

/**
 * The hash is kept beside the contract user rather than inside it: a flat shape would let
 * a `return { user }` carry the password hash into a response body, and neither the types
 * nor the review would notice.
 */
export type UserCredentials = {
  user: User;
  passwordHash: string;
};

@Injectable()
export class UserRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async create(input: { email: string; passwordHash: string }): Promise<User> {
    try {
      return toUser(await this.prismaService.user.create({ data: input }));
    } catch (error) {
      // The unique index decides, not a preceding SELECT: two simultaneous registrations
      // of the same address would both pass such a check.
      if (
        isPrismaError(error, PrismaErrorCode.UniqueViolation) &&
        conflictsOnEmail(error)
      ) {
        throw new EmailAlreadyRegisteredError(input.email);
      }

      throw error;
    }
  }

  /** The only read that carries the hash; everything else leaves on the contract shape. */
  async findByEmail(email: string): Promise<UserCredentials | null> {
    const row = await this.prismaService.user.findUnique({ where: { email } });

    if (row === null) return null;

    return { user: toUser(row), passwordHash: row.passwordHash };
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prismaService.user.findUnique({ where: { id } });

    return row === null ? null : toUser(row);
  }
}

/** A unique violation names the columns it happened on; the path there is the shared one. */
const uniqueConstraintSchema = z.object({ fields: z.array(z.string()) });

/**
 * `email` is the only unique column on the model today, so this is not what makes the
 * answer right — it is what keeps it right once a second one arrives: a conflict on a
 * future `username` must not come back to its owner as a taken email address.
 *
 * A constraint this cannot read counts as the email: the model has no other unique column
 * to confuse it with, and answering a duplicate registration with a 500 would be a worse
 * mistake than naming the wrong field in a case that does not exist yet. `bookings` has
 * two candidate keys and therefore takes the opposite decision — see `violatedConstraint`.
 */
function conflictsOnEmail(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  const constraint = violatedConstraint(error, uniqueConstraintSchema);

  return constraint === null || constraint.fields.includes("email");
}

/** Exported for RefreshTokenRepository, which reads the user row through its relation. */
export function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
  };
}
