import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { mailGroupSchema } from "@repo/contracts";
import { z } from "zod";
import type { DeliverySnapshot } from "../application/mail-task";

const request = z.object({ to: z.string(), body: z.string() });
const snapshot = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("confirm"), request, token: z.string() }),
  z.object({ kind: z.literal("notice"), request, group: mailGroupSchema }),
  z.object({
    kind: z.literal("digest"),
    request,
    replyHash: z.string().nullable(),
    throughId: z.uuid().optional(),
  }),
]);

function key() {
  const secret =
    process.env.MAIL_SNAPSHOT_SECRET || process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error("Missing mail snapshot key");
  return createHash("sha256")
    .update("staydesk-mail/snapshot/v1/" + secret)
    .digest();
}

// Provider requests contain bearer tokens. Bind the ciphertext to the outbox row.
export function sealMailSnapshot(id: string, delivery: DeliverySnapshot) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(id));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(delivery), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
    "base64",
  );
}

export function openMailSnapshot(id: string, value: string): DeliverySnapshot {
  const payload = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    payload.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(id));
  decipher.setAuthTag(payload.subarray(12, 28));
  const decoded = Buffer.concat([
    decipher.update(payload.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
  return snapshot.parse(JSON.parse(decoded));
}
