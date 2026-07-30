import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { verifyToken } from "@clerk/backend";
import {
  fetchGooglePhotoBytes,
  getGoogleApiKey,
  isValidGooglePhotoRef,
  searchGooglePlacePhotos,
} from "./scripts/google-place-photos.mjs";
import {
  bumpPromoRedeemed,
  getCommunityTracker,
  getPlaceOrderStats,
  getPlaceOrderFeed,
  getUserCards,
  initStore,
  logPromoUse,
  markPromoUseReceived,
  recordOrderReport,
  todayLocalDateKey,
  upsertUserCard,
  usesPostgres,
} from "./db/store.mjs";
import {
  assertRateLimit,
  rateLimitBackend,
  secondsUntilUtcMidnight,
  utcDateKey,
} from "./db/rateLimit.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);
/** Max crowd order reports per IP per restaurant per UTC day */
const ORDER_REPORT_PER_PLACE_DAILY_LIMIT = 3;
/** Max crowd order reports per IP per rolling 24h (all places) */
const ORDER_REPORT_PER_IP_DAILY_LIMIT = 30;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY || "";
const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY || "";
const CLERK_JWT_KEY = process.env.CLERK_JWT_KEY || "";

function deriveClerkFrontendApi(publishableKey) {
  try {
    const encoded = String(publishableKey || "").split("_")[2];
    if (!encoded) return "";
    return Buffer.from(encoded, "base64").toString("utf8").replace(/\$+$/, "");
  } catch {
    return "";
  }
}

const CLERK_FRONTEND_API =
  process.env.CLERK_FRONTEND_API ||
  deriveClerkFrontendApi(CLERK_PUBLISHABLE_KEY);

function sendJson(res, status, body, cacheSeconds = 300, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${cacheSeconds}`,
    ...extraHeaders,
  });
  res.end(payload);
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url?.split("?")[0] || "/");
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const placePhotoCache = new Map();
const photoBytesCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const PHOTO_BYTES_TTL_MS = 24 * 60 * 60 * 1000;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function getBearerToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice("Bearer ".length).trim();
}

async function requireClerkUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    throw Object.assign(new Error("Missing token"), { statusCode: 401 });
  }
  if (!CLERK_JWT_KEY && !CLERK_SECRET_KEY) {
    throw Object.assign(new Error("Clerk secret not configured"), { statusCode: 503 });
  }

  const verifyOptions = { authorizedParties: [APP_ORIGIN] };
  if (CLERK_JWT_KEY) verifyOptions.jwtKey = CLERK_JWT_KEY;
  else verifyOptions.secretKey = CLERK_SECRET_KEY;

  const verified = await verifyToken(token, verifyOptions);
  const userId = verified?.sub;
  if (!userId) {
    throw Object.assign(new Error("Invalid token"), { statusCode: 401 });
  }
  return { userId, session: verified };
}

function placeCacheKey(params) {
  return [
    params.get("name"),
    params.get("address"),
    params.get("city"),
    params.get("state"),
    params.get("lat"),
    params.get("lng"),
  ].join("|");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function sendRateLimited(res, err) {
  const retryAfterSeconds = err?.retryAfterSeconds || 60;
  sendJson(
    res,
    429,
    { error: "rate_limited", retryAfterSeconds },
    0,
    { "Retry-After": String(retryAfterSeconds) }
  );
}

const server = http.createServer(async (req, res) => {
  try {
    const apiKey = getGoogleApiKey();

    if (req.url?.startsWith("/api/config")) {
      sendJson(
        res,
        200,
        {
          clerk: {
            enabled: Boolean(CLERK_PUBLISHABLE_KEY && CLERK_FRONTEND_API),
            publishableKey: CLERK_PUBLISHABLE_KEY,
            frontendApi: CLERK_FRONTEND_API,
          },
          dataStore: usesPostgres() ? "postgres" : "json",
          rateLimit: rateLimitBackend(),
        },
        0
      );
      return;
    }

    if (req.url?.startsWith("/api/user-cards/use/receive")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const { userId } = await requireClerkUser(req);
      const body = await readJsonBody(req).catch(() => ({}));
      const cardId = String(body?.cardId || "").trim();
      const useId = String(body?.useId || "").trim();
      const receivedAt = String(body?.receivedAt || todayLocalDateKey()).trim();

      if (!cardId || !useId) {
        sendJson(res, 400, { error: "missing_fields" });
        return;
      }

      try {
        const result = await markPromoUseReceived(userId, {
          cardId,
          useId,
          receivedAt,
        });
        sendJson(res, 200, { ok: true, ...result }, 0);
      } catch (err) {
        if (err?.statusCode) {
          sendJson(res, err.statusCode, { error: err.message });
          return;
        }
        throw err;
      }
      return;
    }

    if (req.url?.startsWith("/api/user-cards/use")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const { userId } = await requireClerkUser(req);
      const body = await readJsonBody(req).catch(() => ({}));
      const bankId = String(body?.bankId || "").trim();
      const label = String(body?.label || "").trim();
      const cardId = body?.cardId ? String(body.cardId).trim() : "";
      const placeId = body?.placeId ? String(body.placeId) : null;
      const usedAt = String(body?.usedAt || todayLocalDateKey()).trim();

      if (!cardId && (!bankId || !label)) {
        sendJson(res, 400, { error: "missing_card_fields" });
        return;
      }

      try {
        const result = await logPromoUse(userId, {
          cardId: cardId || null,
          bankId,
          label,
          placeId,
          usedAt,
        });
        sendJson(res, 200, { ok: true, ...result }, 0);
      } catch (err) {
        if (err?.statusCode) {
          sendJson(res, err.statusCode, {
            error: err.message,
            cards: err.cards,
          });
          return;
        }
        throw err;
      }
      return;
    }

    if (req.url?.startsWith("/api/user-cards")) {
      const { userId } = await requireClerkUser(req);

      if (req.method === "GET") {
        sendJson(res, 200, { cards: await getUserCards(userId) });
        return;
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const bankId = String(body?.bankId || "").trim();
        const label = String(body?.label || "").trim();
        const id = body?.id ? String(body.id) : randomUUID();
        const remainingCount = Math.max(
          0,
          Math.min(10, Number(body?.remainingCount ?? 10))
        );

        if (!bankId || !label) {
          sendJson(res, 400, { error: "missing_card_fields" });
          return;
        }

        const result = await upsertUserCard(userId, {
          id,
          bankId,
          label,
          remainingCount,
        });
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    if (req.url?.startsWith("/api/community-stats")) {
      sendJson(res, 200, await getCommunityTracker(), 15);
      return;
    }

    if (req.url?.startsWith("/api/promo-redeem")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }
      const ip = getClientIp(req);
      try {
        await assertRateLimit({
          key: `rate:promo-redeem:ip:${ip}`,
          limit: 10,
          windowSeconds: 60 * 60,
        });
      } catch (err) {
        if (err?.statusCode === 429) {
          sendRateLimited(res, err);
          return;
        }
        throw err;
      }
      const body = await readJsonBody(req).catch(() => ({}));
      const count = Math.max(1, Math.min(10, Number(body?.count) || 1));
      const community = await bumpPromoRedeemed(count);
      sendJson(res, 200, { ok: true, ...community }, 0);
      return;
    }

    if (req.url?.startsWith("/api/order-report-stats")) {
      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      const placeId = parsed.searchParams.get("placeId") || "";
      if (!placeId) {
        sendJson(res, 400, { error: "missing_placeId", yes: 0, no: 0, total: 0 });
        return;
      }
      sendJson(res, 200, await getPlaceOrderFeed(placeId));
      return;
    }

    if (req.url?.startsWith("/api/order-report")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const body = await readJsonBody(req);
      const placeId = body?.placeId ? String(body.placeId).trim() : "";
      if (!placeId) {
        sendJson(res, 400, { error: "missing_placeId" });
        return;
      }

      const ip = getClientIp(req);
      const day = utcDateKey();
      try {
        await assertRateLimit({
          key: `rate:order-report:ip:${ip}:place:${placeId}:${day}`,
          limit: ORDER_REPORT_PER_PLACE_DAILY_LIMIT,
          windowSeconds: secondsUntilUtcMidnight(),
        });
        await assertRateLimit({
          key: `rate:order-report:ip:${ip}`,
          limit: ORDER_REPORT_PER_IP_DAILY_LIMIT,
          windowSeconds: 24 * 60 * 60,
        });
      } catch (err) {
        if (err?.statusCode === 429) {
          sendRateLimited(res, err);
          return;
        }
        throw err;
      }

      const result = await recordOrderReport({
        placeId,
        orderingUrl: body?.orderingUrl,
        success: !!body?.success,
        cardInstitution: body?.cardInstitution ?? null,
        cardLabel: body?.cardLabel ?? null,
        issueReason: body?.issueReason ?? null,
        device: body?.device ?? null,
        browser: body?.browser ?? null,
        createdAt: body?.createdAt || new Date().toISOString(),
      });

      sendJson(res, 200, { ok: true, ...result }, 0);
      return;
    }

    if (req.url?.startsWith("/api/place-photos")) {
      if (!apiKey) {
        sendJson(res, 503, {
          error: "missing_api_key",
          message: "Set GOOGLE_MAPS_API_KEY in .env",
          all: [],
        });
        return;
      }

      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      const cacheKey = placeCacheKey(parsed.searchParams);
      const cached = placePhotoCache.get(cacheKey);
      if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        sendJson(res, 200, cached.data);
        return;
      }

      const data = await searchGooglePlacePhotos(
        {
          name: parsed.searchParams.get("name") || "",
          address: parsed.searchParams.get("address") || "",
          city: parsed.searchParams.get("city") || "",
          state: parsed.searchParams.get("state") || "",
          lat: parsed.searchParams.get("lat") || "",
          lng: parsed.searchParams.get("lng") || "",
        },
        apiKey
      ).catch((err) => {
        console.error("Places search failed:", err.message);
        return {
          all: [],
          logo: "",
          photos: [],
          provider: "google",
          error: "places_api_failed",
        };
      });

      placePhotoCache.set(cacheKey, { at: Date.now(), data });
      sendJson(res, 200, data);
      return;
    }

    if (req.url?.startsWith("/api/google-photo")) {
      if (!apiKey) {
        res.writeHead(503).end("Google API key not configured");
        return;
      }

      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      const ref = parsed.searchParams.get("ref") || "";
      if (!isValidGooglePhotoRef(ref)) {
        res.writeHead(400).end("Invalid photo ref");
        return;
      }

      const cached = photoBytesCache.get(ref);
      if (cached && Date.now() - cached.at < PHOTO_BYTES_TTL_MS) {
        res.writeHead(200, {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=86400",
        });
        res.end(cached.buffer);
        return;
      }

      const { buffer, contentType } = await fetchGooglePhotoBytes(ref, apiKey);
      photoBytesCache.set(ref, { at: Date.now(), buffer, contentType });
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      });
      res.end(buffer);
      return;
    }

    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (req.url?.startsWith("/api/")) {
      if (err?.statusCode === 429) {
        sendRateLimited(res, err);
        return;
      }
      const statusCode = err?.statusCode || 500;
      sendJson(res, statusCode, {
        error: "server_error",
        message: String(err?.message || err),
        all: [],
      });
    } else {
      res.writeHead(500).end("Server error");
    }
  }
});

await initStore();

server.listen(PORT, () => {
  const key = getGoogleApiKey();
  console.log(`pazetracker http://localhost:${PORT}`);
  console.log(`data store: ${usesPostgres() ? "postgres" : "json"}`);
  console.log(`rate limit: ${rateLimitBackend()}`);
  if (!key) {
    console.warn("GOOGLE_MAPS_API_KEY not set — place photos will not load.");
  }
});
