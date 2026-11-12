import { Prisma } from "../generated/prisma/client";
import { isCheckViolation } from "./prisma.errors";

const CONSTRAINT = "listings_rate_beside_refundable_policy";

/**
 * A `CHECK` violation in the shape Prisma 7 produces through the driver adapter: no
 * constraint field, only the SQLSTATE and the message Postgres worded in its `lc_messages`.
 */
function checkViolation(
  message: string,
  code = "23514",
): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Check constraint failed", {
    code: "P2039",
    clientVersion: "7.0.0",
    meta: {
      modelName: "Listing",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: { kind: "postgres", code, severity: "ERROR", message },
      },
    },
  });
}

describe("isCheckViolation", () => {
  it("reads the constraint's name out of the message, whatever the server's language", () => {
    expect(
      isCheckViolation(
        checkViolation(
          `new row for relation "listings" violates check constraint "${CONSTRAINT}"`,
        ),
        CONSTRAINT,
      ),
    ).toBe(true);
    // A translation quotes an identifier its own way; only the name is relied on.
    expect(
      isCheckViolation(
        checkViolation(
          `neue Zeile für Relation »listings« verletzt Check-Constraint »${CONSTRAINT}«`,
        ),
        CONSTRAINT,
      ),
    ).toBe(true);
  });

  it("does not take another constraint of the table for the one named", () => {
    // The constraints of one table share a prefix, so a name inside a longer one is no match.
    expect(
      isCheckViolation(
        checkViolation(
          `new row for relation "listings" violates check constraint "${CONSTRAINT}_v2"`,
        ),
        CONSTRAINT,
      ),
    ).toBe(false);
    expect(
      isCheckViolation(
        checkViolation(
          'new row for relation "listings" violates check constraint "listings_discount_within_contract"',
        ),
        CONSTRAINT,
      ),
    ).toBe(false);
  });

  it("reads nothing but a CHECK violation", () => {
    expect(
      isCheckViolation(
        checkViolation(
          `conflicting key value violates "${CONSTRAINT}"`,
          "23P01",
        ),
        CONSTRAINT,
      ),
    ).toBe(false);
    expect(isCheckViolation(new Error(CONSTRAINT), CONSTRAINT)).toBe(false);
  });
});
