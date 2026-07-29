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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 5173);

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

const APP_ORIGIN =
  process.env.APP_ORIGIN || `http://localhost:${PORT}`;
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

function sendJson(res, status, body, cacheSeconds = 300) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": `public, max-age=${cacheSeconds}`,
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

// -----------------------------
// Order crowdsource reporting
// -----------------------------
const ORDER_REPORTS_PATH = path.join(ROOT, "data", "order-reports.ndjson");
fs.mkdirSync(path.dirname(ORDER_REPORTS_PATH), { recursive: true });
const USER_CARDS_PATH = path.join(ROOT, "data", "user-cards.json");
const COMMUNITY_STATS_PATH = path.join(ROOT, "data", "community-stats.json");
const PROMO_REFUND_REPORTS_PATH = path.join(ROOT, "data", "promo-refund-reports.ndjson");
fs.mkdirSync(path.dirname(PROMO_REFUND_REPORTS_PATH), { recursive: true });

/** @type {Map<string, { yes: number, no: number, lastReportedAt: string | null }>} */
const orderStatsByPlaceId = new Map();

const PZ_PROMO_VALUE_DOLLARS = 10;

/** @type {{ promosRedeemed: number, promosRefundConfirmed: number, successfulOrders: number, failedOrders: number, updatedAt: string | null }} */
let communityStats = {
  promosRedeemed: 0,
  promosRefundConfirmed: 0,
  successfulOrders: 0,
  failedOrders: 0,
  updatedAt: null,
};

function persistCommunityStats() {
  fs.writeFileSync(COMMUNITY_STATS_PATH, JSON.stringify(communityStats, null, 2));
}

function readCommunityStatsFile() {
  if (!fs.existsSync(COMMUNITY_STATS_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(COMMUNITY_STATS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return {
      promosRedeemed: Math.max(0, Number(parsed.promosRedeemed) || 0),
      promosRefundConfirmed: Math.max(
        0,
        Number(parsed.promosRefundConfirmed) || 0
      ),
      successfulOrders: Math.max(0, Number(parsed.successfulOrders) || 0),
      failedOrders: Math.max(0, Number(parsed.failedOrders) || 0),
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return null;
  }
}

function loadOrderStatsFromDisk() {
  let yes = 0;
  let no = 0;
  let updatedAt = null;
  if (!fs.existsSync(ORDER_REPORTS_PATH)) {
    return { yes, no, updatedAt };
  }
  const raw = fs.readFileSync(ORDER_REPORTS_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      if (!r?.placeId) continue;
      const s = orderStatsByPlaceId.get(r.placeId) || {
        yes: 0,
        no: 0,
        lastReportedAt: null,
      };
      if (r.success) {
        s.yes += 1;
        yes += 1;
      } else {
        s.no += 1;
        no += 1;
      }
      s.lastReportedAt = r.createdAt || null;
      orderStatsByPlaceId.set(r.placeId, s);
      updatedAt = r.createdAt || updatedAt;
    } catch {
      // ignore corrupted lines
    }
  }
  return { yes, no, updatedAt };
}

const derivedOrderTotals = loadOrderStatsFromDisk();
const savedCommunityStats = readCommunityStatsFile();
communityStats = {
  promosRedeemed: Math.max(
    savedCommunityStats?.promosRedeemed || 0,
    derivedOrderTotals.yes
  ),
  promosRefundConfirmed: Math.max(0, savedCommunityStats?.promosRefundConfirmed || 0),
  successfulOrders: Math.max(
    savedCommunityStats?.successfulOrders || 0,
    derivedOrderTotals.yes
  ),
  failedOrders: Math.max(
    savedCommunityStats?.failedOrders || 0,
    derivedOrderTotals.no
  ),
  updatedAt:
    savedCommunityStats?.updatedAt || derivedOrderTotals.updatedAt || null,
};
persistCommunityStats();

function computeCommunityTracker() {
  const promosPending = Math.max(
    0,
    communityStats.promosRedeemed - communityStats.promosRefundConfirmed
  );
  const promosConfirmed = Math.max(0, communityStats.promosRefundConfirmed);
  return {
    promosRedeemed: communityStats.promosRedeemed,
    promosPending,
    promosRefundConfirmed: promosConfirmed,
    pendingCreditsDollars: promosPending * PZ_PROMO_VALUE_DOLLARS,
    confirmedCreditsDollars: promosConfirmed * PZ_PROMO_VALUE_DOLLARS,
    promoValueDollars: PZ_PROMO_VALUE_DOLLARS,
    updatedAt: communityStats.updatedAt,
  };
}

const promoRefundDedupe = new Set();

function loadPromoRefundDedupeFromDisk() {
  if (!fs.existsSync(PROMO_REFUND_REPORTS_PATH)) return;
  const raw = fs.readFileSync(PROMO_REFUND_REPORTS_PATH, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const r = JSON.parse(line);
      const userId = r?.userId;
      const cardId = r?.cardId;
      const receivedAt = r?.receivedAt;
      if (!userId || !cardId || !receivedAt) continue;
      promoRefundDedupe.add(`${userId}|${cardId}|${receivedAt}`);
    } catch {
      // ignore corrupted lines
    }
  }
}

loadPromoRefundDedupeFromDisk();

function loadUserCardsStore() {
  if (!fs.existsSync(USER_CARDS_PATH)) return {};
  try {
    const raw = fs.readFileSync(USER_CARDS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

let userCardsStore = loadUserCardsStore();

function persistUserCardsStore() {
  fs.writeFileSync(USER_CARDS_PATH, JSON.stringify(userCardsStore, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      // Basic guard to prevent huge payloads.
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
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

  const verifyOptions = {
    authorizedParties: [APP_ORIGIN],
  };
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

const server = http.createServer(async (req, res) => {
  try {
    const apiKey = getGoogleApiKey();

    if (req.url?.startsWith("/api/config")) {
      sendJson(res, 200, {
        clerk: {
          enabled: Boolean(CLERK_PUBLISHABLE_KEY && CLERK_FRONTEND_API),
          publishableKey: CLERK_PUBLISHABLE_KEY,
          frontendApi: CLERK_FRONTEND_API,
        },
      }, 0);
      return;
    }

    if (req.url?.startsWith("/api/user-cards")) {
      const { userId } = await requireClerkUser(req);

      if (req.method === "GET") {
        const cards = Array.isArray(userCardsStore[userId]) ? userCardsStore[userId] : [];
        sendJson(res, 200, { cards });
        return;
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const bankId = String(body?.bankId || "").trim();
        const label = String(body?.label || "").trim();
        const id = body?.id ? String(body.id) : randomUUID();
        const remainingCount = Math.max(0, Math.min(10, Number(body?.remainingCount ?? 10)));

        if (!bankId || !label) {
          sendJson(res, 400, { error: "missing_card_fields" });
          return;
        }

        const cards = Array.isArray(userCardsStore[userId]) ? userCardsStore[userId] : [];
        const index = cards.findIndex((c) => c.id === id);
        const next = {
          id,
          bankId,
          label,
          remainingCount,
          updatedAt: new Date().toISOString(),
          createdAt: index >= 0 ? cards[index].createdAt : new Date().toISOString(),
        };
        if (index >= 0) cards[index] = next;
        else cards.unshift(next);
        userCardsStore[userId] = cards;
        persistUserCardsStore();
        sendJson(res, 200, { cards, savedCardId: id });
        return;
      }

      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    if (req.url?.startsWith("/api/community-stats")) {
      sendJson(res, 200, computeCommunityTracker(), 15);
      return;
    }

    if (req.url?.startsWith("/api/promo-redeem")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }
      const body = await readJsonBody(req).catch(() => ({}));
      const count = Math.max(1, Math.min(10, Number(body?.count) || 1));
      communityStats.promosRedeemed += count;
      communityStats.promosRefundConfirmed = Math.min(
        communityStats.promosRefundConfirmed,
        communityStats.promosRedeemed
      );
      communityStats.updatedAt = new Date().toISOString();
      persistCommunityStats();
      sendJson(res, 200, { ok: true, ...computeCommunityTracker() }, 0);
      return;
    }

    if (req.url?.startsWith("/api/promo-refund-confirm")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const { userId } = await requireClerkUser(req);
      const body = await readJsonBody(req).catch(() => ({}));
      const cardId = String(body?.cardId || "").trim();
      const receivedAt = String(body?.receivedAt || "").trim();
      const count = Math.max(1, Math.min(10, Number(body?.count) || 1));

      if (!cardId || !receivedAt) {
        sendJson(res, 400, { error: "missing_fields" });
        return;
      }

      const dedupeKeyBase = `${userId}|${cardId}|${receivedAt}`;
      if (promoRefundDedupe.has(dedupeKeyBase)) {
        sendJson(res, 200, { ok: true, ...computeCommunityTracker(), deduped: true }, 0);
        return;
      }

      promoRefundDedupe.add(dedupeKeyBase);
      fs.appendFileSync(
        PROMO_REFUND_REPORTS_PATH,
        JSON.stringify({
          userId,
          cardId,
          receivedAt,
          count,
          createdAt: new Date().toISOString(),
        }) + "\n"
      );

      communityStats.promosRefundConfirmed += count;
      communityStats.promosRefundConfirmed = Math.min(
        communityStats.promosRefundConfirmed,
        communityStats.promosRedeemed
      );
      communityStats.updatedAt = new Date().toISOString();
      persistCommunityStats();

      sendJson(res, 200, { ok: true, ...computeCommunityTracker() }, 0);
      return;
    }

    if (req.url?.startsWith("/api/order-report-stats")) {
      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      const placeId = parsed.searchParams.get("placeId") || "";
      if (!placeId) {
        sendJson(res, 400, { error: "missing_placeId", yes: 0, no: 0, total: 0 });
        return;
      }
      const s = orderStatsByPlaceId.get(placeId) || {
        yes: 0,
        no: 0,
        lastReportedAt: null,
      };
      const total = s.yes + s.no;
      const payload = {
        placeId,
        yes: s.yes,
        no: s.no,
        total,
        successRate: total ? s.yes / total : null,
        lastReportedAt: s.lastReportedAt,
      };
      sendJson(res, 200, payload);
      return;
    }

    if (req.url?.startsWith("/api/order-report")) {
      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" });
        return;
      }

      const body = await readJsonBody(req);
      const placeId = body?.placeId;
      const orderingUrl = body?.orderingUrl;
      const success = !!body?.success;
      const createdAt = body?.createdAt || new Date().toISOString();

      if (!placeId) {
        sendJson(res, 400, { error: "missing_placeId" });
        return;
      }

      const s = orderStatsByPlaceId.get(placeId) || {
        yes: 0,
        no: 0,
        lastReportedAt: null,
      };
      if (success) {
        s.yes += 1;
        communityStats.successfulOrders += 1;
        communityStats.promosRedeemed += 1;
        communityStats.promosRefundConfirmed = Math.min(
          communityStats.promosRefundConfirmed,
          communityStats.promosRedeemed
        );
      } else {
        s.no += 1;
        communityStats.failedOrders += 1;
      }
      s.lastReportedAt = createdAt;
      orderStatsByPlaceId.set(placeId, s);
      communityStats.updatedAt = createdAt;
      persistCommunityStats();

      // Persist for later server restarts.
      const reportLine = JSON.stringify({
        placeId,
        orderingUrl: orderingUrl || "",
        success,
        cardInstitution: body?.cardInstitution ?? null,
        cardLabel: body?.cardLabel ?? null,
        createdAt,
      });
      fs.appendFileSync(ORDER_REPORTS_PATH, reportLine + "\n");

      sendJson(res, 200, {
        ok: true,
        yes: s.yes,
        no: s.no,
        total: s.yes + s.no,
        community: computeCommunityTracker(),
      }, 0);
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
      );

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
      const statusCode = err?.statusCode || 500;
      sendJson(res, statusCode, { error: "server_error", message: String(err?.message || err), all: [] });
    } else {
      res.writeHead(500).end("Server error");
    }
  }
});

server.listen(PORT, () => {
  const key = getGoogleApiKey();
  console.log(`pazetracker http://localhost:${PORT}`);
  if (!key) {
    console.warn("GOOGLE_MAPS_API_KEY not set — place photos will not load.");
  }
});
