import { describe, expect, it } from "vitest";
import { registerSchema } from "./auth.js";

describe("registration email", () => {
  it("preserves the mailbox spelling and normalizes the IDNA domain", () => {
    const email = "  Alice!+booking@ПРИМЕР.РФ  ";
    expect(registerSchema.parse({ email }).email).toBe(
      "Alice!+booking@xn--e1afmkfd.xn--p1ai",
    );
  });

  it.each([
    "alice..guest@example.com",
    "alice@example-.com",
    "alice@127.0.0.1",
    "alice@other.invalid",
    "имя@example.com",
    "a".repeat(65) + "@example.com",
  ])("refuses unsupported mailbox %s", (email) => {
    expect(registerSchema.safeParse({ email }).success).toBe(false);
  });
});
