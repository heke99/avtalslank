import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicIpv4,
  signingConfigured,
  processSigningJob,
} from "../apps/worker/signing.ts";
import { deliveryToken } from "../packages/signing/src/links.ts";
import { boundedBytes } from "../supabase/functions/avtalslank-api/connected.ts";
test("webhook target policy rejects private, mapped, documentation and local addresses", () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.31.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "198.18.1.1",
    "192.0.2.1",
    "203.0.113.1",
    "::ffff:127.0.0.1",
    "::1",
    "not-an-ip",
  ])
    assert.equal(publicIpv4(ip), false, ip);
  assert.equal(publicIpv4("8.8.8.8"), true);
});
test("link derivation is bound to session ID and server key; configuration fails closed", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.notEqual(
    await deliveryToken("a".repeat(64), id),
    await deliveryToken("b".repeat(64), id),
  );
  assert.notEqual(
    await deliveryToken("a".repeat(64), id),
    await deliveryToken("a".repeat(64), "22222222-2222-4222-8222-222222222222"),
  );
  assert.equal(
    signingConfigured({
      secret: "a".repeat(64),
      publicOrigin: "https://app.example.com",
      resendKey: "test",
      from: "signing@example.invalid",
      domainVerified: false,
    }),
    false,
  );
});
test("streaming request limits abort oversized bodies before allocation and allow exact limit", async () => {
  const request = (bytes: number) =>
    new Request("https://example.invalid", {
      method: "POST",
      body: new Uint8Array(bytes),
    });
  assert.equal((await boundedBytes(request(5), 5)).length, 5);
  await assert.rejects(boundedBytes(request(6), 5), /BODY_TOO_LARGE/);
});
test("email timeout persists reconciliation, accepted is separate from delivered", async () => {
  const config = {
    secret: "a".repeat(64),
    publicOrigin: "https://avtalslank.test",
    resendKey: "test-only",
    from: "signing@example.invalid",
    domainVerified: true,
  };
  const outcomes: any[] = [];
  const db: any = {
    rpc: async (_name: string, args: any) => {
      outcomes.push(args.p_payload);
      return { data: {}, error: null };
    },
  };
  const work = {
    job: {
      id: "id",
      lease_token: "lease",
      kind: "invitation",
      attempts: 1,
      effect_key: "stable",
      payload: {
        recipientId: "recipient",
        linkId: "11111111-1111-4111-8111-111111111111",
      },
    },
    snapshot: {
      envelope: { title: "Avtal" },
      recipients: [
        { id: "recipient", name: "Person", email: "person@example.invalid" },
      ],
    },
    expiresAt: "2099-01-01T00:00:00Z",
  };
  await processSigningJob(db, config, work, {
    fetch: async () => {
      throw Error("timeout");
    },
    postWebhook: async () => 204,
  } as any);
  assert.equal(outcomes.at(-1).status, "reconcile");
  await processSigningJob(db, config, work, {
    fetch: async () =>
      new Response(JSON.stringify({ id: "provider-id" }), { status: 200 }),
    postWebhook: async () => 204,
  } as any);
  assert.equal(outcomes.at(-1).status, "accepted");
  assert.equal(outcomes.at(-1).reference, "provider-id");
});
