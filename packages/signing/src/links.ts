import { hmacSha256Hex } from "../../crypto/src/hmac.ts";
// Random session IDs carry no authority. Only holders of the server key can derive a link.
// Store hashes in sessions and only the random ID in the durable delivery outbox.
export async function deliveryToken(secret: string, sessionId: string) {
  if (!/^[a-f0-9]{64,}$/.test(secret) || !/^[a-f0-9-]{36}$/i.test(sessionId))
    throw Error("SIGNING_DELIVERY_NOT_CONFIGURED");
  return hmacSha256Hex(secret, `avtalslank.signing-link.v1:${sessionId}`);
}
