import { ECDH } from "node:crypto";

/** The wire schema checks the encoding. OpenSSL checks that the point is on the curve. */
export function isPushPublicKey(key: string): boolean {
  try {
    ECDH.convertKey(key, "prime256v1", "base64url");
    return true;
  } catch {
    return false;
  }
}
