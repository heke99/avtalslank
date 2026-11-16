import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson } from "../packages/crypto/src/canonical-json.ts";
import { sha256Hex } from "../packages/crypto/src/hash.ts";
import {
  signWebhook,
  verifyWebhook,
  assertSafeWebhookUrl,
} from "../packages/webhooks/src/index.ts";
import {
  createEvidenceManifest,
  verifyEvidenceFiles,
} from "../packages/evidence/src/index.ts";
import {
  signingReadiness,
  recipientSchema,
  validateFields,
  isPdf,
} from "../packages/domain/src/index.ts";
import {
  UnconfiguredBillingProvider,
  canStartCheckout,
  usageKey,
} from "../packages/billing/src/index.ts";
import { RejectingTicEvidenceVerifier } from "../packages/provider-adapters/src/tic-bankid.ts";
import { RejectingFrejaSignatureVerifier } from "../packages/provider-adapters/src/freja.ts";
import { rescaleSignatureGroups } from "../packages/documents/src/signature-viewport.ts";

test("ported canonical evidence and crypto detect altered documents", async () => {
  assert.equal(canonicalJson({ z: 2, a: 1 }), '{"a":1,"z":2}');
  assert.throws(() => canonicalJson({ x: Infinity }));
  const bytes = new TextEncoder().encode("%PDF-1.7");
  const hash = await sha256Hex(bytes);
  assert.equal(hash.length, 64);
  assert.notEqual(hash, await sha256Hex("%PDF-1.6"));
  assert.ok(isPdf(bytes));
});
test("ported webhook verifier rejects tampering, expiry and private literals", async () => {
  const signed = await signWebhook(
    { event: "envelope.completed" },
    "a-long-test-secret",
    "1700000000",
  );
  assert.ok(await verifyWebhook(signed, "a-long-test-secret", 1700000001));
  assert.equal(
    await verifyWebhook(
      { ...signed, body: "{}" },
      "a-long-test-secret",
      1700000001,
    ),
    false,
  );
  assert.equal(
    await verifyWebhook(signed, "a-long-test-secret", 1700000900),
    false,
  );
  assert.throws(() => assertSafeWebhookUrl("https://127.0.0.1/test"));
  assert.throws(() => assertSafeWebhookUrl("http://example.com"));
  assert.equal(
    assertSafeWebhookUrl("https://example.com/hook").protocol,
    "https:",
  );
});
test("method policies block unverified signers and validate recipients", () => {
  assert.ok(
    signingReadiness([{ status: "ready" }], [{ method: "freja" }], []).some(
      (i) => i.includes("Freja"),
    ),
  );
  assert.equal(
    recipientSchema.safeParse({
      name: "Person",
      email: "bad",
      method: "bankid",
      position: 1,
    }).success,
    false,
  );
  assert.throws(() =>
    validateFields([
      {
        id: "a",
        label: "Text",
        type: "text",
        recipientRole: "Kund",
        required: true,
        page: 0,
        x: 0.9,
        y: 0,
        width: 0.2,
        height: 0.1,
      },
    ]),
  );
});
test("billing remains undecided; no payment provider can charge", async () => {
  assert.equal(
    canStartCheckout({
      model: "unconfigured",
      currency: "SEK",
      provider: null,
      priceVersion: null,
    }),
    false,
  );
  await assert.rejects(
    new UnconfiguredBillingProvider().createCheckout(),
    /NOT_CONFIGURED/,
  );
  assert.equal(
    usageKey("document_completed", "envelope-1", "document-1", 1),
    "document_completed:envelope-1:document-1:v1",
  );
  assert.throws(() => usageKey("document_completed", "x", "y", 0));
});
test("BankID port fails closed without independent evidence verifier", async () => {
  await assert.rejects(
    new RejectingTicEvidenceVerifier().verify(),
    /not configured/,
  );
});
test("ported signature resize retains all original strokes", () => {
  const original = [
    {
      points: [
        { x: 2, y: 3 },
        { x: 4, y: 5 },
      ],
    },
  ];
  const result = rescaleSignatureGroups(original, 2, 3);
  assert.deepEqual(result[0].points, [
    { x: 4, y: 9 },
    { x: 8, y: 15 },
  ]);
  assert.equal(original[0].points[0].x, 2);
});
test("ported evidence manifest rejects replaced or missing file bytes", async () => {
  const files = [
    {
      path: "contract.pdf",
      bytes: new TextEncoder().encode("%PDF-1.7 original"),
      mediaType: "application/pdf",
    },
  ];
  const manifest = await createEvidenceManifest("test-envelope", files, {
    method: "freja",
  });
  assert.deepEqual(await verifyEvidenceFiles(manifest, files), []);
  assert.ok(
    (
      await verifyEvidenceFiles(manifest, [
        { ...files[0], bytes: new TextEncoder().encode("%PDF altered") },
      ])
    ).length > 0,
  );
  assert.ok(
    (await verifyEvidenceFiles(manifest, [])).some((v) =>
      v.includes("Missing"),
    ),
  );
});
test("Freja port refuses unverified signatures by default", async () => {
  await assert.rejects(
    new RejectingFrejaSignatureVerifier().verifyJws(),
    /not configured|NOT_CONFIGURED|verification/i,
  );
});
