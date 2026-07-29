import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const ORDER_REPORTS_PATH = path.join(ROOT, "data", "order-reports.ndjson");
fs.mkdirSync(path.dirname(ORDER_REPORTS_PATH), { recursive: true });

/** @type {Map<string, { yes: number, no: number, lastReportedAt: string | null }>} */
const orderStatsByPlaceId = new Map();

function loadOrderStatsFromDisk() {
  if (!fs.existsSync(ORDER_REPORTS_PATH)) return;
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
      if (r.success) s.yes += 1;
      else s.no += 1;
      s.lastReportedAt = r.createdAt || null;
      orderStatsByPlaceId.set(r.placeId, s);
    } catch {
      // ignore corrupted lines
    }
  }
}

loadOrderStatsFromDisk();

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
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
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
      sendJson(res, 200, {
        placeId,
        yes: s.yes,
        no: s.no,
        total,
        successRate: total ? s.yes / total : null,
        lastReportedAt: s.lastReportedAt,
      });
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
      if (success) s.yes += 1;
      else s.no += 1;
      s.lastReportedAt = createdAt;
      orderStatsByPlaceId.set(placeId, s);

      const reportLine = JSON.stringify({
        placeId,
        orderingUrl: orderingUrl || "",
        success,
        cardInstitution: body?.cardInstitution ?? null,
        cardLabel: body?.cardLabel ?? null,
        createdAt,
      });
      fs.appendFileSync(ORDER_REPORTS_PATH, reportLine + "\n");

      sendJson(res, 200, { ok: true, yes: s.yes, no: s.no, total: s.yes + s.no });
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

    if (req.url?.startsWith("/api/")) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }

    serveStatic(req, res);
  } catch (err) {
    console.error(err);
    if (req.url?.startsWith("/api/")) {
      sendJson(res, 500, {
        error: "server_error",
        message: String(err?.message || err),
        all: [],
      });
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
