import {queryRoute} from "./query.ts";
import {operationsRoute} from "./operations.ts";
import { connectedRoute, publicSigning, boundedBytes } from "./connected.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { sha256Hex } from "../../../packages/crypto/src/hash.ts";
import { randomToken } from "../../../packages/crypto/src/tokens.ts";
import {
  draftSchema,
  recipientSchema,
} from "../../../packages/domain/src/index.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const publicKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const allowedOrigins = new Set(
  (
    Deno.env.get("ALLOWED_ORIGINS") ??
    "https://avtalslank.se,https://app.avtalslank.se,https://avtalslank.vercel.app,http://localhost:5173,http://127.0.0.1:5173"
  ).split(","),
);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function requireId(v: unknown): string {
  if (typeof v !== "string" || !uuid.test(v)) throw new Error("INVALID_ID");
  return v;
}
const safeCodes = new Set([
  "INVALID_SIGNING_LINK",
  "LINK_ALREADY_USED",
  "DOCUMENT_SET_CHANGED",
  "WAITING_FOR_PREVIOUS_RECIPIENT",
  "INVALID_DECISION",
  "REQUIRED_FIELD",
  "UNASSIGNED_FIELD",
  "INVALID_FIELD_ASSIGNMENT",
  "FINAL_DOCUMENT_NOT_READY",
  "SIGNING_WORKER_NOT_READY",
  "INVALID_LINKS",
  "ORIGINAL_CHANGED",
  "BODY_TOO_LARGE",
  "INVALID_PDF",
  "UPLOAD_CONFLICT",
  "INVALID_WEBHOOK_CONFIGURATION",
  "WEBHOOK_NOT_FOUND",
  "DOCUMENT_TOTAL_LIMIT",
  "INVALID_INVITATION", "INVITATION_NOT_FOUND", "INVITATION_LIMIT", "ALREADY_MEMBER", "LAST_OWNER", "OWNER_REQUIRED", "RECIPIENT_NOT_PENDING", "DELIVERY_PENDING", "DELIVERY_RECONCILIATION_REQUIRED", "REMINDER_LIMIT", "REMINDER_COOLDOWN",
  "MFA_REQUIRED",
  "INVALID_QUERY", "INVALID_CURSOR",
  "INVALID_ID",
  "INVALID_BODY",
  "INVALID_FIELDS",
  "RECIPIENT_NOT_FOUND",
  "DOCUMENT_NOT_FOUND",
  "INVALID_RECIPIENT_ORDER",
  "INVALID_PERIOD",
  "INVALID_PAGE",
  "MEMBERSHIP_REVOKED",
  "ACCESS_DENIED",
  "ADMIN_REQUIRED",
  "AUTH_REQUIRED",
  "INVALID_API_KEY",
  "SCOPE_DENIED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "VERSION_CONFLICT",
  "ENVELOPE_NOT_FOUND",
  "DOCUMENT_LOCKED",
  "DOCUMENT_REQUIRED",
  "DOCUMENT_SCAN_REQUIRED",
  "RECIPIENT_REQUIRED",
  "SIGNING_METHOD_NOT_READY",
  "SIGNING_DELIVERY_NOT_CONFIGURED",
  "UPLOAD_NOT_FOUND",
  "DOCUMENT_LIMIT",
  "INVALID_FIELDS",
  "INVALID_FIELD",
  "FIELD_OUTSIDE_PAGE",
  "KEY_NOT_FOUND",
  "INVALID_KEY",
  "CANCELLATION_NOT_SUPPORTED_FOR_STATE",
]);

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
    "Access-Control-Expose-Headers":"X-Request-Id",
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] =
      "authorization, apikey, content-type, idempotency-key, x-client-info";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
  }
  const response = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });
  if (origin && !allowedOrigins.has(origin))
    return response({ error: { code: "ORIGIN_DENIED", requestId } }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  try {
    const path = new URL(req.url).pathname.split("/avtalslank-api")[1] || "/";
    if (path === "/health" && req.method === "GET")
      return response({
        service: "avtalslank",
        status: "ok",
        billing: "unconfigured",
      });
    const publicResult = await publicSigning(req, path, service);
    if (publicResult instanceof Response) {
      for (const [k, v] of Object.entries(headers))
        if (!publicResult.headers.has(k)) publicResult.headers.set(k, v);
      return publicResult;
    }
    if (publicResult) return response(publicResult);
    const auth = req.headers.get("authorization") ?? "";
    if (!auth.startsWith("Bearer "))
      return response({ error: { code: "AUTH_REQUIRED", requestId } }, 401);
    const token = auth.slice(7);
    const isApi = token.startsWith("al_live_");
    const client = isApi
      ? service
      : createClient(url, publicKey, {
          global: { headers: { Authorization: auth } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
    let verifiedActor: string | null = null;
    if (!isApi) {
      const { data, error } = await client.auth.getUser(token);
      if (error || !data.user)
        return response({ error: { code: "AUTH_REQUIRED", requestId } }, 401);
      verifiedActor = data.user.id;
      if(data.user.factors?.some(f=>f.status==='verified')){
        const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        if(claims.aal!=='aal2')throw Error('MFA_REQUIRED');
      }
    }
    let body: Record<string, unknown> = {};
    if (
      req.method === "POST" &&
      req.headers.get("content-type")?.split(";")[0] !== "application/pdf"
    ) {
      const raw = new TextDecoder().decode(await boundedBytes(req, 65536));
      if (raw.length > 65536)
        return response({ error: { code: "BODY_TOO_LARGE", requestId } }, 413);
      body = JSON.parse(raw || "{}");
      if (!body || Array.isArray(body) || typeof body !== "object")
        throw new Error("INVALID_BODY");
    }
    const opResult=await operationsRoute(req,path,service,{actor:verifiedActor,keyHash:isApi?await sha256Hex(token):null,organizationId:isApi?null:(body.organizationId??new URL(req.url).searchParams.get('organizationId')) as string|null},body);
    if(opResult)return response(opResult);
    const connected = await connectedRoute(
      req,
      path,
      service,
      {
        actor: verifiedActor,
        keyHash: isApi ? await sha256Hex(token) : null,
        organizationId: isApi
          ? null
          : ((body.organizationId ??
              new URL(req.url).searchParams.get("organizationId")) as
              | string
              | null),
      },
      body,
    );
    if (connected instanceof Response) {
      for (const [k, v] of Object.entries(headers))
        if (!connected.headers.has(k)) connected.headers.set(k, v);
      return connected;
    }
    if (connected) return response(connected);
    const queryResult=await queryRoute(req,path,service,{actor:verifiedActor,keyHash:isApi?await sha256Hex(token):null,organizationId:isApi?null:new URL(req.url).searchParams.get('organizationId')});
    if(queryResult)return response(queryResult);
    let action = "";
    let payload: Record<string, unknown> = {};
    let rpc = "";
    let args: Record<string, unknown> = {};
    const org = () =>
      requireId(
        body.organizationId ??
          new URL(req.url).searchParams.get("organizationId"),
      );
    if (path === "/v1/methods" && req.method === "GET") {
      if (isApi) {
        const { error } = await service.rpc("al_api_dispatch", {
          p_hash: await sha256Hex(token),
          p_action: "list_envelopes",
        });
        if (error) throw error;
      }
      const { data, error } = await service.rpc("al_capabilities");
      if (error) throw error;
      return response({ data });
    }
    if (path === "/v1/envelopes" && req.method === "POST") {
      payload = draftSchema.parse(body.draft);
      action = "save_draft";
      rpc = "al_save_draft";
      args = {
        p_org: isApi ? null : org(),
        p_title: payload.title,
        p_message: payload.message,
        p_sequential: payload.sequential,
        p_expires_days: payload.expiresDays,
      };
    } else if (path === "/v1/envelopes" && req.method === "GET") {
      action = "list_envelopes";
      if (!isApi) {
        const { data, error } = await client
          .from("al_envelopes")
          .select("*")
          .eq("organization_id", org())
          .order("updated_at", { ascending: false })
          .limit(100);
        if (error) throw error;
        return response({ data });
      }
    } else if (
      /^\/v1\/envelopes\/[a-f0-9-]+\/recipients$/.test(path) &&
      req.method === "POST"
    ) {
      const id = requireId(path.split("/")[3]);
      payload = { ...recipientSchema.parse(body.recipient), envelopeId: id };
      action = "add_recipient";
      rpc = "al_add_recipient";
      args = {
        p_org: isApi ? null : org(),
        p_envelope: id,
        p_name: payload.name,
        p_email: payload.email,
        p_method: payload.method,
        p_position: payload.position,
      };
    } else if (
      /^\/v1\/envelopes\/[a-f0-9-]+\/(send|cancel)$/.test(path) &&
      req.method === "POST"
    ) {
      const parts = path.split("/");
      const id = requireId(parts[3]);
      action = parts[4];
      payload = { envelopeId: id, generation: body.generation };
      rpc = action === "send" ? "al_send_envelope" : "al_cancel_envelope";
      args = {
        p_org: isApi ? null : org(),
        p_envelope: id,
        ...(action === "send" ? { p_generation: body.generation } : {}),
      };
    } else if (
      /^\/v1\/envelopes\/[a-f0-9-]+$/.test(path) &&
      req.method === "GET"
    ) {
      const id = requireId(path.split("/")[3]);
      action = "get_envelope";
      payload = { id };
      if (!isApi) {
        const { data, error } = await client
          .from("al_envelopes")
          .select("*")
          .eq("organization_id", org())
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        return response({ data }, data ? 200 : 404);
      }
    } else if (path === "/v1/billing" && req.method === "GET") {
      action = "billing";
      if (!isApi) {
        const { data, error } = await client
          .from("al_billing_accounts")
          .select("model,currency,enabled,provider,price_version")
          .eq("organization_id", org())
          .single();
        if (error) throw error;
        return response({ data });
      }
    } else if (path === "/v1/api-keys" && req.method === "POST" && !isApi) {
      const raw = "al_live_" + randomToken();
      const prefix = raw.slice(0, 16);
      const { data, error } = await client.rpc("al_issue_api_key", {
        p_org: org(),
        p_name: body.name,
        p_prefix: prefix,
        p_hash: await sha256Hex(raw),
        p_scopes: body.scopes,
      });
      if (error) throw error;
      return response({ data: { id: data, key: raw, prefix } }, 201);
    } else if (
      req.method === "POST" &&
      /^\/v1\/envelopes\/[a-f0-9-]+\/(edit-recipient|remove-recipient|reorder-recipients|remove-document|duplicate)$/.test(
        path,
      )
    ) {
      const parts = path.split("/"),
        id = requireId(parts[3]);
      const route = parts[4];
      const commands: Record<string, string> = {
        "edit-recipient": "edit_recipient",
        "remove-recipient": "remove_recipient",
        "reorder-recipients": "reorder_recipients",
        "remove-document": "remove_document",
        duplicate: "duplicate_draft",
      };
      action = commands[route];
      rpc = "al_" + action;
      payload = { ...body, envelopeId: id };
      delete payload.organizationId;
      args = { p_org: isApi ? null : org(), p_envelope: id };
      if (route === "edit-recipient") {
        const r = recipientSchema
          .omit({ position: true })
          .parse(body.recipient);
        payload = { ...r, id: requireId(body.id), envelopeId: id };
        args = {
          ...args,
          p_id: payload.id,
          p_name: r.name,
          p_email: r.email,
          p_method: r.method,
        };
      } else if (route === "reorder-recipients") {
        if (!Array.isArray(body.ids) || body.ids.length > 50)
          throw new Error("INVALID_BODY");
        payload = { envelopeId: id, ids: body.ids.map(requireId) };
        args.p_ids = payload.ids;
      } else if (route === "duplicate") {
        if (
          typeof body.title !== "string" ||
          body.title.trim().length < 2 ||
          body.title.length > 160
        )
          throw new Error("INVALID_BODY");
        payload = { envelopeId: id, title: body.title };
        args.p_title = body.title;
      } else {
        payload = { envelopeId: id, id: requireId(body.id) };
        args.p_id = payload.id;
      }
    } else if (path === "/v1/contacts" && req.method === "GET") {
      action = "list_contacts";
      if (!isApi) {
        const { data, error } = await client
          .from("al_contacts")
          .select("*")
          .eq("organization_id", org())
          .eq("archived", false)
          .order("name")
          .limit(200);
        if (error) throw error;
        return response({ data });
      }
    } else if (path === "/v1/contacts" && req.method === "POST") {
      action = "save_contact";
      rpc = "al_save_contact";
      const r = recipientSchema
        .omit({ position: true, method: true })
        .parse({ name: body.name, email: body.email });
      if (
        body.company !== undefined &&
        (typeof body.company !== "string" || body.company.length > 160)
      )
        throw new Error("INVALID_BODY");
      if (body.archived !== undefined && typeof body.archived !== "boolean")
        throw new Error("INVALID_BODY");
      payload = {
        ...r,
        company: body.company ?? "",
        id: body.id ? requireId(body.id) : null,
        version: body.version ?? null,
        archived: body.archived ?? false,
      };
      args = {
        p_org: isApi ? null : org(),
        p_name: r.name,
        p_email: r.email,
        p_company: payload.company,
        p_id: payload.id,
        p_version: payload.version,
        p_archived: payload.archived,
      };
    } else if (path === "/v1/activity" && req.method === "GET") {
      const q = new URL(req.url).searchParams;
      action = "activity";
      rpc = "al_activity";
      const limit = Number(q.get("limit") ?? 50);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200)
        throw new Error("INVALID_PAGE");
      payload = {
        limit,
        beforeTime: q.get("beforeTime"),
        beforeId: q.get("beforeId"),
      };
      args = {
        p_org: isApi ? null : org(),
        p_limit: limit,
        p_before_time: payload.beforeTime,
        p_before_id: payload.beforeId,
      };
    } else if (path === "/v1/usage" && req.method === "GET") {
      const q = new URL(req.url).searchParams;
      action = "usage_summary";
      rpc = "al_usage_summary";
      payload = { from: q.get("from"), to: q.get("to") };
      args = {
        p_org: isApi ? null : org(),
        p_from: payload.from,
        p_to: payload.to,
      };
    } else if (path === "/v1/templates" && req.method === "GET") {
      action = "list_templates";
      if (!isApi) {
        const { data, error } = await client
          .from("al_templates")
          .select("*")
          .eq("organization_id", org())
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) throw error;
        return response({ data });
      }
    } else if (path === "/v1/templates" && req.method === "POST") {
      action = "save_template";
      rpc = "al_save_template";
      if (
        typeof body.name !== "string" ||
        body.name.trim().length < 2 ||
        body.name.length > 160 ||
        !Array.isArray(body.fields) ||
        body.fields.length > 200
      )
        throw new Error("INVALID_FIELDS");
      payload = {
        name: body.name,
        fields: body.fields,
        id: body.id ? requireId(body.id) : null,
        version: body.version ?? null,
      };
      args = {
        p_org: isApi ? null : org(),
        p_name: body.name,
        p_fields: body.fields,
        p_id: payload.id,
        p_version: payload.version,
      };
    } else return response({ error: { code: "NOT_FOUND", requestId } }, 404);
    const result = isApi
      ? await service.rpc("al_api_dispatch", {
          p_hash: await sha256Hex(token),
          p_action: action,
          p_payload: payload,
          p_idempotency_key: req.headers.get("idempotency-key"),
        })
      : await client.rpc(rpc, args);
    if (result.error) throw result.error;
    return response(
      { data: result.data },
      req.method === "POST" && action === "save_draft" ? 201 : 200,
    );
  } catch (error) {
    const e = error as { message?: string; name?: string; code?: string };
    const code = safeCodes.has(e.message ?? "")
      ? e.message!
      : e.name === "ZodError"
        ? "VALIDATION_FAILED"
        : e.code === "23505"
          ? "ALREADY_EXISTS"
          : e.code === "23514"
            ? "VALIDATION_FAILED"
            : e instanceof SyntaxError
              ? "INVALID_JSON"
              : "REQUEST_FAILED";
    const status = [
      "AUTH_REQUIRED",
      "INVALID_API_KEY",
      "INVALID_SIGNING_LINK",
    ].includes(code)
      ? 401
      : ["ACCESS_DENIED", "ADMIN_REQUIRED", "SCOPE_DENIED"].includes(code)
        ? 403
        : [
              "VERSION_CONFLICT",
              "IDEMPOTENCY_CONFLICT",
              "LINK_ALREADY_USED",
              "ALREADY_EXISTS",
            ].includes(code)
          ? 409
          : code === "ENVELOPE_NOT_FOUND"
            ? 404
            : code.endsWith("NOT_CONFIGURED") ||
                code === "SIGNING_METHOD_NOT_READY"
              ? 422
              : code === "REQUEST_FAILED"
                ? 500
                : 400;
    return response({ error: { code, requestId } }, status);
  }
});
