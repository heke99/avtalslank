import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { sha256Hex } from "../packages/crypto/src/hash.ts";
import {
  inspectUpload,
  assignFields,
  pdfRectangle,
  issueLink,
  verifyLink,
  recipientView,
  validateDecision,
  documentSetHash,
  signingInvitation,
  retryDelivery,
  finalPdf,
  evidencePackage,
  workerReadiness,
  signingWebhook,
  type SigningField,
} from "../packages/signing/src/index.ts";
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  c = "33333333-3333-4333-8333-333333333333";
const field: SigningField = {
  id: c,
  documentId: a,
  recipientId: b,
  type: "text",
  label: "Name",
  required: true,
  page: 0,
  x: 0.1,
  y: 0.1,
  width: 0.5,
  height: 0.05,
};
async function original() {
  const p = await PDFDocument.create();
  p.addPage([600, 800]);
  return p.save();
}
test("upload validates bytes, digest, real PDF and page limits", async () => {
  const bytes = await original(),
    meta = {
      documentId: a,
      envelopeId: c,
      name: "avtal.pdf",
      sha256: await sha256Hex(bytes),
      byteSize: bytes.length,
    };
  assert.equal((await inspectUpload(meta, bytes)).pages.length, 1);
  await assert.rejects(
    inspectUpload({ ...meta, sha256: "a".repeat(64) }, bytes),
    /UPLOAD_INTEGRITY/,
  );
  await assert.rejects(inspectUpload({ ...meta, extra: true }, bytes));
});
test("field assignment binds recipient and document, rejects duplicates and out of page", () => {
  assert.equal(assignFields([field], [{ id: a, pages: 1 }], [b]).length, 1);
  for (const fields of [
    [field, field],
    [{ ...field, recipientId: c }],
    [{ ...field, page: 1 }],
    [{ ...field, x: 0.9 }],
  ])
    assert.throws(() => assignFields(fields, [{ id: a, pages: 1 }], [b]));
  assert.deepEqual(pdfRectangle(field, { width: 600, height: 800 }), {
    x: 60,
    y: 680,
    width: 300,
    height: 40,
  });
});
test("opaque links reject wrong token, stale generation, revocation, reuse and expiry", async () => {
  const now = Date.parse("2026-11-16T10:00:00Z");
  const { token, record } = await issueLink(
    {
      recipientId: b,
      envelopeId: a,
      generation: 2,
      expiresAt: new Date(now + 60000).toISOString(),
    },
    now,
  );
  assert.equal((await verifyLink(token, record, 2, now)).recipientId, b);
  for (const r of [
    { ...record, revokedAt: "now" },
    { ...record, consumedAt: "now" },
    record,
  ])
    await assert.rejects(
      verifyLink(token, r, r === record ? 3 : 2, now),
      /INVALID_SIGNING_LINK/,
    );
  await assert.rejects(verifyLink("a".repeat(64), record, 2, now));
  await assert.rejects(verifyLink(token, record, 2, now + 60000));
  assert.ok(!JSON.stringify(record).includes(token));
});
test("recipient projection omits other identities and private storage paths", () => {
  const result = recipientView(
    b,
    [
      {
        id: b,
        name: "Person",
        email: "hidden@example.invalid",
        method: "email_approval",
        position: 1,
        status: "pending",
      },
    ],
    [field],
    [
      {
        id: a,
        name: "Avtal",
        sha256: "a".repeat(64),
        storage_path: "private/path",
      },
    ],
    true,
  );
  assert.ok(!JSON.stringify(result).includes("private/path"));
  assert.ok(!JSON.stringify(result).includes("hidden@example.invalid"));
  assert.equal(result.fields.length, 1);
});
test("approval binds intent, document set, assignment and configured method", () => {
  const d = {
    intent: "approve",
    documentSetHash: "a".repeat(64),
    consent: true,
    consentVersion: "v1",
    values: { [c]: "Person" },
  };
  assert.equal(
    validateDecision(d, d.documentSetHash, [field], b, "email_approval", false)
      .intent,
    "approve",
  );
  for (const [input, hash, method, waiting] of [
    [{ ...d, consent: false }, d.documentSetHash, "email_approval", false],
    [d, "b".repeat(64), "email_approval", false],
    [d, d.documentSetHash, "bankid", false],
    [d, d.documentSetHash, "email_approval", true],
  ] as const)
    assert.throws(() =>
      validateDecision(input, hash, [field], b, method, waiting),
    );
  assert.throws(
    () =>
      validateDecision(
        { ...d, values: { [a]: "foreign" } },
        d.documentSetHash,
        [field],
        b,
        "email_approval",
        false,
      ),
    /UNASSIGNED_FIELD/,
  );
  assert.equal(
    validateDecision(
      { ...d, intent: "decline", consent: false },
      d.documentSetHash,
      [field],
      b,
      "bankid",
      false,
    ).intent,
    "decline",
  );
});
test("snapshot hash is order stable and changes with document or field version", async () => {
  const docs = [
    { id: a, sha256: "a".repeat(64) },
    { id: b, sha256: "b".repeat(64) },
  ];
  const hash = await documentSetHash(docs, [field], 1);
  assert.equal(hash, await documentSetHash([...docs].reverse(), [field], 1));
  assert.notEqual(hash, await documentSetHash(docs, [field], 2));
});
test("email template escapes content and refuses external authentication links", () => {
  const data = {
    name: "<script>",
    title: "A & B",
    url: "https://avtalslank.se/s/token",
    expiresAt: "2026-11-17T00:00:00Z",
  };
  const mail = signingInvitation(data, "https://avtalslank.se");
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(!mail.html.includes("<script>"));
  assert.ok(mail.text.includes(data.url));
  assert.throws(() =>
    signingInvitation(
      { ...data, url: "https://evil.example/s/token" },
      "https://avtalslank.se",
    ),
  );
});
test("unknown delivery outcome requires reconciliation, no blind resend", () => {
  assert.equal(retryDelivery(1, "unknown", 0).status, "reconcile");
  assert.equal(retryDelivery(5, "temporary", 0).status, "failed");
  assert.equal(retryDelivery(1, "accepted", 0).status, "accepted");
  assert.equal(
    retryDelivery(1, "temporary", 0, 120).retryAt,
    "1970-01-01T00:02:00.000Z",
  );
});
test("final PDF preserves original, checks hash and renders a separate result", async () => {
  const bytes = await original(),
    hash = await sha256Hex(bytes);
  const final = await finalPdf(bytes, hash, [field], { [c]: "Person" }, a);
  assert.equal(await sha256Hex(bytes), hash);
  assert.notEqual(final.sha256, hash);
  assert.equal((await PDFDocument.load(final.bytes)).getPageCount(), 1);
  await assert.rejects(
    finalPdf(bytes, "a".repeat(64), [field], { [c]: "Person" }, a),
    /ORIGINAL_CHANGED/,
  );
  await assert.rejects(finalPdf(bytes, hash, [field], {}, a), /REQUIRED_FIELD/);
});
test("evidence refuses ambiguous paths and worker readiness never exposes secrets", async () => {
  const f = {
    path: "original.pdf",
    bytes: new Uint8Array([1]),
    mediaType: "application/pdf",
  };
  assert.equal(
    (await evidencePackage(a, [f], {}, "2026-11-16T00:00:00Z")).entries.length,
    1,
  );
  await assert.rejects(evidencePackage(a, [f, f], {}, "2026-11-16T00:00:00Z"));
  await assert.rejects(
    evidencePackage(
      a,
      [{ ...f, path: "../original.pdf" }],
      {},
      "2026-11-16T00:00:00Z",
    ),
  );
  const ready = workerReadiness({ serviceKey: "secret" });
  assert.equal(ready.ready, false);
  assert.ok(!JSON.stringify(ready).includes("secret"));
});

test("webhook binds stable event identity and rejects arbitrary payload data", async () => {
  const input = {
    id: a,
    organizationId: b,
    envelopeId: c,
    type: "envelope.completed",
    occurredAt: "2026-11-16T00:00:00Z",
    generation: 1,
  };
  const result = await signingWebhook(input, "a".repeat(32), 1000);
  const { verifyWebhook } = await import("../packages/webhooks/src/index.ts");
  assert.equal(await verifyWebhook(result, "a".repeat(32), 1000), true);
  assert.equal(result.deliveryKey, `${b}:${a}`);
  await assert.rejects(
    signingWebhook(
      { ...input, email: "private@example.invalid" },
      "a".repeat(32),
      1000,
    ),
  );
});
