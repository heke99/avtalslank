import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { sha256Hex } from "../../packages/crypto/src/hash.ts";
import {
  ClamAvInstreamClient,
  QpdfInspector,
} from "../../packages/document-processing/src/production.ts";

const port = Number(process.env.PORT ?? 8080);
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY,
  clamHost = process.env.CLAMAV_HOST;
const configured = Boolean(url && key && clamHost);
const db =
  url && key
    ? createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;
let stopping = false,
  lastPoll = Date.now();
let processing = false;
const server = createServer((req, res) => {
  if (req.url !== "/health") {
    res.writeHead(404);
    res.end();
    return;
  }
  const healthy = configured && !stopping && Date.now() - lastPoll < 120000;
  res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      service: "avtalslank-document-worker",
      configured,
      healthy,
      processing,
    }),
  );
});
server.listen(port, "::");
async function tick() {
  if (stopping || processing || !db || !clamHost) return;
  lastPoll = Date.now();
  processing = true;
  let job: {
    id: string;
    leaseToken: string;
    document: {
      id: string;
      storage_path: string;
      sha256: string;
      byte_size: number;
    };
  } | null = null;
  try {
    const claimed = await db.rpc("al_claim_document_job");
    if (claimed.error) throw claimed.error;
    job = claimed.data;
    if (!job) return;
    const download = await db.storage
      .from("al-documents")
      .download(job.document.storage_path);
    if (download.error) throw download.error;
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    if (
      bytes.length !== Number(job.document.byte_size) ||
      (await sha256Hex(bytes)) !== job.document.sha256
    )
      throw new Error("DOCUMENT_INTEGRITY_MISMATCH");
    const [malware, pdf] = await Promise.all([
      new ClamAvInstreamClient(
        clamHost,
        Number(process.env.CLAMAV_PORT ?? 3310),
        30000,
        10485760,
      ).scan(bytes),
      new QpdfInspector("qpdf", 30000).inspect(bytes, {
        maximumBytes: 10485760,
        maximumPages: 100,
      }),
    ]);
    const report = {
      sha256: await sha256Hex(bytes),
      byteSize: bytes.length,
      malware: malware.result,
      pdf: pdf.passed && !pdf.encrypted ? "PASS" : "FAIL",
      scanner: malware.engine,
      scannerVersion: malware.engineVersion,
      pdfTool: pdf.engine,
      pdfVersion: pdf.engineVersion,
      checkedAt: new Date().toISOString(),
    };
    const completed = await db.rpc("al_finish_document_job", {
      p_id: job.id,
      p_lease: job.leaseToken,
      p_report: report,
    });
    if (completed.error) throw completed.error;
  } catch {
    // Do not log document bytes, tokens, provider payloads or raw errors.
    console.error(
      JSON.stringify({ event: "document_job_failed", jobId: job?.id ?? null }),
    );
    if (job)
      await db.rpc("al_finish_document_job", {
        p_id: job.id,
        p_lease: job.leaseToken,
        p_report: null,
        p_error: "DOCUMENT_PROCESSING_FAILED",
      });
  } finally {
    processing = false;
    lastPoll = Date.now();
  }
}
const timer = setInterval(() => void tick(), 5000);
void tick();
async function stop() {
  stopping = true;
  clearInterval(timer);
  const deadline = Date.now() + 60000;
  while (processing && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100));
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
