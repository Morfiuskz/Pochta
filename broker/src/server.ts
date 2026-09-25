import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const CLIENT_ID = "01a0d7ea156e7e919401cdd18b520c21";
const REDIRECT_URI = "http://127.0.0.1:43825/oauth/callback";
const TOKEN_ENDPOINT = "https://o2.mail.ru/api/v1/oidc/token/issue";
const BODY_LIMIT = 16 * 1024;
const UPSTREAM_LIMIT = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;
const CLIENT_SECRET = process.env.MAIL_OAUTH_CLIENT_SECRET;
if (!CLIENT_SECRET || /[\r\n]/u.test(CLIENT_SECRET)) {
  throw new Error("MAIL_OAUTH_CLIENT_SECRET is required");
}

interface RateBucket {
  startedAt: number;
  count: number;
}

class RequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const rateBuckets = new Map<string, RateBucket>();
let nextRateCleanup = 0;

const responseHeaders = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function sendJson(
  response: ServerResponse,
  status: number,
  body: object,
  headers: Record<string, string> = {},
) {
  response.writeHead(status, { ...responseHeaders, ...headers });
  response.end(JSON.stringify(body));
}

function safeText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const safe = [...value]
    .filter((character) => !/\p{Cc}/u.test(character))
    .join("")
    .slice(0, 300)
    .trim();
  return safe || fallback;
}

function safeErrorCode(value: unknown) {
  if (typeof value !== "string") return "token_exchange_failed";
  const safe = [...value]
    .filter((character) => /[A-Za-z0-9_.-]/u.test(character))
    .join("")
    .slice(0, 64);
  return safe || "token_exchange_failed";
}

function safeDescription(value: unknown, sensitiveValues: string[]) {
  let safe = safeText(value, "Mail OAuth отклонил запрос.");
  for (const sensitive of sensitiveValues) {
    if (sensitive) safe = safe.split(sensitive).join("[скрыто]");
  }
  return safe;
}

function requestIp(request: IncomingMessage) {
  const remote = request.socket.remoteAddress || "unknown";
  const fromLoopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    remote,
  );
  const forwarded = request.headers["x-real-ip"];
  if (
    fromLoopback &&
    typeof forwarded === "string" &&
    forwarded.length <= 64 &&
    /^[0-9a-f:.]+$/i.test(forwarded)
  ) {
    return forwarded;
  }
  return remote;
}

function checkRateLimit(request: IncomingMessage) {
  const now = Date.now();
  if (now >= nextRateCleanup) {
    for (const [key, bucket] of rateBuckets) {
      if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
    }
    nextRateCleanup = now + RATE_WINDOW_MS;
  }
  const key = requestIp(request);
  const existing = rateBuckets.get(key);
  const bucket =
    !existing || now - existing.startedAt >= RATE_WINDOW_MS
      ? { startedAt: now, count: 0 }
      : existing;
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  if (bucket.count > RATE_LIMIT) {
    const retryAfter = Math.max(
      1,
      Math.ceil((RATE_WINDOW_MS - (now - bucket.startedAt)) / 1000),
    );
    throw new RequestError(
      429,
      "temporarily_unavailable",
      `Слишком много запросов. Повторите через ${retryAfter} сек.`,
    );
  }
}

async function readForm(request: IncomingMessage) {
  const contentType = String(request.headers["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new RequestError(
      415,
      "invalid_request",
      "Требуется Content-Type application/x-www-form-urlencoded.",
    );
  }
  const declaredLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(declaredLength) && declaredLength > BODY_LIMIT) {
    throw new RequestError(413, "invalid_request", "Слишком большой запрос.");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) {
      throw new RequestError(413, "invalid_request", "Слишком большой запрос.");
    }
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function one(form: URLSearchParams, name: string, maxLength: number) {
  const values = form.getAll(name);
  if (values.length !== 1 || !values[0]) {
    throw new RequestError(
      400,
      "invalid_request",
      `Некорректный параметр ${name}.`,
    );
  }
  const value = values[0];
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RequestError(
      400,
      "invalid_request",
      `Некорректный параметр ${name}.`,
    );
  }
  return value;
}

function onlyFields(form: URLSearchParams, allowed: ReadonlySet<string>) {
  for (const field of form.keys()) {
    if (!allowed.has(field)) {
      throw new RequestError(
        400,
        "invalid_request",
        "Запрос содержит неподдерживаемые параметры.",
      );
    }
  }
}

function upstreamForm(input: URLSearchParams) {
  const grantType = one(input, "grant_type", 64);
  const clientId = one(input, "client_id", 128);
  if (clientId !== CLIENT_ID) {
    throw new RequestError(401, "invalid_client", "Неизвестное OAuth-приложение.");
  }

  const output = new URLSearchParams({ grant_type: grantType });
  if (grantType === "authorization_code") {
    onlyFields(
      input,
      new Set([
        "grant_type",
        "client_id",
        "code",
        "redirect_uri",
        "code_verifier",
      ]),
    );
    const redirectUri = one(input, "redirect_uri", 256);
    if (redirectUri !== REDIRECT_URI) {
      throw new RequestError(400, "invalid_grant", "Redirect URI не разрешён.");
    }
    const verifier = one(input, "code_verifier", 128);
    if (verifier.length < 43 || !/^[A-Za-z0-9_-]+$/u.test(verifier)) {
      throw new RequestError(400, "invalid_grant", "Некорректный PKCE verifier.");
    }
    output.set("code", one(input, "code", 4096));
    output.set("redirect_uri", redirectUri);
    output.set("code_verifier", verifier);
    return output;
  }
  if (grantType === "refresh_token") {
    onlyFields(
      input,
      new Set(["grant_type", "client_id", "refresh_token"]),
    );
    output.set("client_id", CLIENT_ID);
    output.set("refresh_token", one(input, "refresh_token", 16_384));
    return output;
  }
  throw new RequestError(
    400,
    "unsupported_grant_type",
    "Поддерживаются только authorization_code и refresh_token.",
  );
}

async function readUpstream(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > UPSTREAM_LIMIT) {
    throw new Error("upstream_response_too_large");
  }
  if (!response.body) throw new Error("empty_upstream_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > UPSTREAM_LIMIT) {
      await reader.cancel();
      throw new Error("upstream_response_too_large");
    }
    chunks.push(value);
  }
  return JSON.parse(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
  ) as unknown;
}

async function exchange(request: IncomingMessage, response: ServerResponse) {
  checkRateLimit(request);
  const fields = upstreamForm(await readForm(request));
  const sensitiveValues = [
    fields.get("code") || "",
    fields.get("code_verifier") || "",
    fields.get("refresh_token") || "",
  ];
  let upstream: Response;
  try {
    upstream = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Pochta-Mail-OAuth-Broker/0.1",
      },
      body: fields,
    });
  } catch {
    throw new RequestError(
      504,
      "temporarily_unavailable",
      "Mail OAuth временно недоступен.",
    );
  }

  let payload: unknown;
  try {
    payload = await readUpstream(upstream);
  } catch {
    throw new RequestError(
      502,
      "server_error",
      "Mail OAuth вернул некорректный ответ.",
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RequestError(
      502,
      "server_error",
      "Mail OAuth вернул некорректный ответ.",
    );
  }
  const oauth = payload as Record<string, unknown>;
  if (upstream.ok) {
    if (
      typeof oauth.access_token !== "string" ||
      typeof oauth.expires_in !== "number"
    ) {
      throw new RequestError(
        502,
        "server_error",
        "Mail OAuth вернул некорректный ответ.",
      );
    }
    sendJson(response, 200, oauth);
    return;
  }
  const status = upstream.status >= 400 && upstream.status <= 599 ? upstream.status : 502;
  sendJson(response, status, {
    error: safeErrorCode(oauth.error),
    error_description: safeDescription(oauth.error_description, sensitiveValues),
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health" && !url.search) {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname !== "/mail/token" || url.search) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  if (request.method !== "POST") {
    sendJson(
      response,
      405,
      { error: "method_not_allowed" },
      { Allow: "POST" },
    );
    return;
  }
  try {
    await exchange(request, response);
  } catch (error) {
    if (error instanceof RequestError) {
      sendJson(response, error.status, {
        error: error.code,
        error_description: error.message,
      });
      return;
    }
    sendJson(response, 500, {
      error: "server_error",
      error_description: "Внутренняя ошибка OAuth broker.",
    });
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("Invalid PORT");
}
const host = process.env.HOST || "127.0.0.1";
server.listen(port, host, () => {
  console.log(`Mail OAuth broker listens on ${host}:${port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
