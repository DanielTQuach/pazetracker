import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isPostgresEnabled, query, withTransaction } from "./client.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const ORDER_REPORTS_PATH = path.join(DATA_DIR, "order-reports.ndjson");
const USER_CARDS_PATH = path.join(DATA_DIR, "user-cards.json");
const COMMUNITY_STATS_PATH = path.join(DATA_DIR, "community-stats.json");
const PROMO_REFUND_REPORTS_PATH = path.join(DATA_DIR, "promo-refund-reports.ndjson");

fs.mkdirSync(DATA_DIR, { recursive: true });

const PZ_PROMO_VALUE_DOLLARS = 10;

/** @type {Map<string, { yes: number, no: number, lastReportedAt: string | null }>} */
const orderStatsByPlaceId = new Map();

/** @type {{ promosRedeemed: number, promosRefundConfirmed: number, successfulOrders: number, failedOrders: number, updatedAt: string | null }} */
let communityStats = {
  promosRedeemed: 0,
  promosRefundConfirmed: 0,
  successfulOrders: 0,
  failedOrders: 0,
  updatedAt: null,
};

/** @type {Record<string, any[]>} */
let userCardsStore = {};

const promoRefundDedupe = new Set();

export function todayLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return todayLocalDateKey(value);
  const raw = String(value);
  return raw.slice(0, 10);
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizePromoUses(uses) {
  if (!Array.isArray(uses)) return [];
  return uses
    .filter((u) => u && typeof u === "object")
    .map((u) => ({
      id: String(u.id || randomUUID()),
      promoNumber: Math.max(1, Math.min(10, Number(u.promoNumber) || 1)),
      usedAt: String(u.usedAt || todayLocalDateKey()),
      receivedAt: u.receivedAt ? String(u.receivedAt) : null,
      placeId: u.placeId ? String(u.placeId) : null,
      createdAt: String(u.createdAt || new Date().toISOString()),
    }))
    .sort(
      (a, b) =>
        b.promoNumber - a.promoNumber ||
        String(a.usedAt).localeCompare(String(b.usedAt))
    );
}

function normalizeCard(card) {
  return {
    ...card,
    remainingCount: Math.max(0, Math.min(10, Number(card?.remainingCount ?? 10))),
    uses: normalizePromoUses(card?.uses),
  };
}

function computeCommunityTrackerFromStats(stats) {
  const promosPending = Math.max(0, stats.promosRedeemed - stats.promosRefundConfirmed);
  const promosConfirmed = Math.max(0, stats.promosRefundConfirmed);
  return {
    promosRedeemed: stats.promosRedeemed,
    promosPending,
    promosRefundConfirmed: promosConfirmed,
    pendingCreditsDollars: promosPending * PZ_PROMO_VALUE_DOLLARS,
    confirmedCreditsDollars: promosConfirmed * PZ_PROMO_VALUE_DOLLARS,
    promoValueDollars: PZ_PROMO_VALUE_DOLLARS,
    updatedAt: stats.updatedAt,
  };
}

function persistCommunityStatsJson() {
  fs.writeFileSync(COMMUNITY_STATS_PATH, JSON.stringify(communityStats, null, 2));
}

function persistUserCardsStoreJson() {
  fs.writeFileSync(USER_CARDS_PATH, JSON.stringify(userCardsStore, null, 2));
}

function loadJsonCommunityStats() {
  if (!fs.existsSync(COMMUNITY_STATS_PATH)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(COMMUNITY_STATS_PATH, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return {
      promosRedeemed: Math.max(0, Number(parsed.promosRedeemed) || 0),
      promosRefundConfirmed: Math.max(0, Number(parsed.promosRefundConfirmed) || 0),
      successfulOrders: Math.max(0, Number(parsed.successfulOrders) || 0),
      failedOrders: Math.max(0, Number(parsed.failedOrders) || 0),
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return null;
  }
}

function loadJsonOrderStats() {
  let yes = 0;
  let no = 0;
  let updatedAt = null;
  if (!fs.existsSync(ORDER_REPORTS_PATH)) return { yes, no, updatedAt };
  const raw = fs.readFileSync(ORDER_REPORTS_PATH, "utf8");
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
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
      // ignore
    }
  }
  return { yes, no, updatedAt };
}

function loadJsonUserCards() {
  if (!fs.existsSync(USER_CARDS_PATH)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(USER_CARDS_PATH, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function loadJsonPromoRefundDedupe() {
  if (!fs.existsSync(PROMO_REFUND_REPORTS_PATH)) return;
  const raw = fs.readFileSync(PROMO_REFUND_REPORTS_PATH, "utf8");
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    try {
      const r = JSON.parse(line);
      if (!r?.userId || !r?.cardId || !r?.receivedAt) continue;
      promoRefundDedupe.add(`${r.userId}|${r.cardId}|${r.receivedAt}`);
    } catch {
      // ignore
    }
  }
}

function initJsonStore() {
  const derived = loadJsonOrderStats();
  const saved = loadJsonCommunityStats();
  communityStats = {
    promosRedeemed: Math.max(saved?.promosRedeemed || 0, derived.yes),
    promosRefundConfirmed: Math.max(0, saved?.promosRefundConfirmed || 0),
    successfulOrders: Math.max(saved?.successfulOrders || 0, derived.yes),
    failedOrders: Math.max(saved?.failedOrders || 0, derived.no),
    updatedAt: saved?.updatedAt || derived.updatedAt || null,
  };
  persistCommunityStatsJson();
  userCardsStore = loadJsonUserCards();
  loadJsonPromoRefundDedupe();
}

export async function initStore() {
  if (isPostgresEnabled()) {
    // Ensure singleton community_stats row exists.
    await query(
      `INSERT INTO community_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING`
    );
    console.log("Data store: Postgres (DATABASE_URL)");
    return { mode: "postgres" };
  }
  initJsonStore();
  console.warn("Data store: local JSON files (set DATABASE_URL for Postgres)");
  return { mode: "json" };
}

export async function getCommunityTracker() {
  if (!isPostgresEnabled()) {
    return computeCommunityTrackerFromStats(communityStats);
  }
  const { rows } = await query(
    `SELECT promos_redeemed, promos_refund_confirmed, successful_orders, failed_orders, updated_at
     FROM community_stats WHERE id = 1`
  );
  const row = rows[0] || {};
  return computeCommunityTrackerFromStats({
    promosRedeemed: Number(row.promos_redeemed) || 0,
    promosRefundConfirmed: Number(row.promos_refund_confirmed) || 0,
    successfulOrders: Number(row.successful_orders) || 0,
    failedOrders: Number(row.failed_orders) || 0,
    updatedAt: toIso(row.updated_at),
  });
}

export async function bumpPromoRedeemed(count = 1) {
  const n = Math.max(1, Math.min(10, Number(count) || 1));
  if (!isPostgresEnabled()) {
    communityStats.promosRedeemed += n;
    communityStats.promosRefundConfirmed = Math.min(
      communityStats.promosRefundConfirmed,
      communityStats.promosRedeemed
    );
    communityStats.updatedAt = new Date().toISOString();
    persistCommunityStatsJson();
    return getCommunityTracker();
  }
  await query(
    `UPDATE community_stats
     SET promos_redeemed = promos_redeemed + $1,
         promos_refund_confirmed = LEAST(promos_refund_confirmed, promos_redeemed + $1)
     WHERE id = 1`,
    [n]
  );
  return getCommunityTracker();
}

async function mapCardRow(cardRow, usesRows) {
  return normalizeCard({
    id: String(cardRow.id),
    bankId: cardRow.bank_id,
    label: cardRow.label,
    remainingCount: cardRow.remaining_count,
    createdAt: toIso(cardRow.created_at),
    updatedAt: toIso(cardRow.updated_at),
    uses: usesRows.map((u) => ({
      id: String(u.id),
      promoNumber: u.promo_number,
      usedAt: toDateKey(u.used_at),
      receivedAt: toDateKey(u.received_at),
      placeId: u.place_id,
      createdAt: toIso(u.created_at),
    })),
  });
}

export async function getUserCards(userId) {
  if (!isPostgresEnabled()) {
    const cards = Array.isArray(userCardsStore[userId]) ? userCardsStore[userId] : [];
    return cards.map(normalizeCard);
  }

  const { rows: cards } = await query(
    `SELECT id, bank_id, label, remaining_count, created_at, updated_at
     FROM user_cards
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId]
  );
  if (!cards.length) return [];

  const { rows: uses } = await query(
    `SELECT id, card_id, promo_number, used_at, received_at, place_id, created_at
     FROM promo_uses
     WHERE user_id = $1
     ORDER BY promo_number DESC, used_at ASC`,
    [userId]
  );

  const usesByCard = new Map();
  for (const use of uses) {
    const key = String(use.card_id);
    const list = usesByCard.get(key) || [];
    list.push(use);
    usesByCard.set(key, list);
  }

  return Promise.all(
    cards.map((card) => mapCardRow(card, usesByCard.get(String(card.id)) || []))
  );
}

export async function upsertUserCard(userId, { id, bankId, label, remainingCount }) {
  const cardId = id || randomUUID();
  const remaining = Math.max(0, Math.min(10, Number(remainingCount ?? 10)));

  if (!isPostgresEnabled()) {
    const cards = Array.isArray(userCardsStore[userId]) ? userCardsStore[userId] : [];
    const index = cards.findIndex((c) => c.id === cardId);
    const existing = index >= 0 ? cards[index] : null;
    const next = normalizeCard({
      id: cardId,
      bankId,
      label,
      remainingCount: remaining,
      uses: existing?.uses || [],
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt || new Date().toISOString(),
    });
    if (index >= 0) cards[index] = next;
    else cards.unshift(next);
    userCardsStore[userId] = cards;
    persistUserCardsStoreJson();
    return { cards: cards.map(normalizeCard), savedCardId: cardId };
  }

  await query(
    `INSERT INTO user_cards (id, user_id, bank_id, label, remaining_count)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE
       SET bank_id = EXCLUDED.bank_id,
           label = EXCLUDED.label,
           remaining_count = EXCLUDED.remaining_count,
           updated_at = now()
     WHERE user_cards.user_id = $2`,
    [cardId, userId, bankId, label, remaining]
  );

  const cards = await getUserCards(userId);
  return { cards, savedCardId: cardId };
}

/**
 * Remove a synced card and its personal promo_uses history.
 * Does not change community_stats (pending/confirmed/promos reported stay).
 */
export async function deleteUserCard(userId, cardId) {
  const id = String(cardId || "").trim();
  if (!id) {
    const err = new Error("missing_card_id");
    err.statusCode = 400;
    throw err;
  }

  if (!isPostgresEnabled()) {
    const cards = Array.isArray(userCardsStore[userId]) ? userCardsStore[userId] : [];
    const next = cards.filter((c) => String(c.id) !== id);
    if (next.length === cards.length) {
      const err = new Error("card_not_found");
      err.statusCode = 404;
      throw err;
    }
    userCardsStore[userId] = next;
    persistUserCardsStoreJson();
    return { cards: next.map(normalizeCard), deletedCardId: id };
  }

  const { rowCount } = await query(
    `DELETE FROM user_cards WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!rowCount) {
    const err = new Error("card_not_found");
    err.statusCode = 404;
    throw err;
  }

  const cards = await getUserCards(userId);
  return { cards, deletedCardId: id };
}

export async function logPromoUse(userId, { cardId, bankId, label, placeId, usedAt }) {
  const usedDate = usedAt || todayLocalDateKey();

  if (!isPostgresEnabled()) {
    const cards = Array.isArray(userCardsStore[userId]) ? [...userCardsStore[userId]] : [];
    let card = cardId
      ? cards.find((c) => c.id === cardId)
      : cards.find((c) => c.bankId === bankId && c.label === label);

    if (!card) {
      if (!bankId || !label) {
        const err = new Error("card_not_found");
        err.statusCode = 404;
        throw err;
      }
      card = {
        id: randomUUID(),
        bankId,
        label,
        remainingCount: 10,
        uses: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      cards.unshift(card);
    }

    card = normalizeCard(card);
    if (card.remainingCount <= 0) {
      const err = new Error("no_promos_left");
      err.statusCode = 400;
      err.cards = cards.map(normalizeCard);
      throw err;
    }

    const use = {
      id: randomUUID(),
      promoNumber: card.remainingCount,
      usedAt: usedDate,
      receivedAt: null,
      placeId: placeId || null,
      createdAt: new Date().toISOString(),
    };
    card.uses = normalizePromoUses([...(card.uses || []), use]);
    card.remainingCount = Math.max(0, card.remainingCount - 1);
    card.updatedAt = new Date().toISOString();

    const index = cards.findIndex((c) => c.id === card.id);
    if (index >= 0) cards[index] = card;
    else cards.unshift(card);
    userCardsStore[userId] = cards;
    persistUserCardsStoreJson();

    return {
      cards: cards.map(normalizeCard),
      savedCardId: card.id,
      use,
    };
  }

  return withTransaction(async (client) => {
    let cardRow = null;
    if (cardId) {
      const found = await client.query(
        `SELECT id, bank_id, label, remaining_count, created_at, updated_at
         FROM user_cards WHERE id = $1 AND user_id = $2`,
        [cardId, userId]
      );
      cardRow = found.rows[0] || null;
    } else if (bankId && label) {
      const found = await client.query(
        `SELECT id, bank_id, label, remaining_count, created_at, updated_at
         FROM user_cards
         WHERE user_id = $1 AND bank_id = $2 AND label = $3
         ORDER BY updated_at DESC
         LIMIT 1`,
        [userId, bankId, label]
      );
      cardRow = found.rows[0] || null;
    }

    if (!cardRow) {
      if (!bankId || !label) {
        const err = new Error("card_not_found");
        err.statusCode = 404;
        throw err;
      }
      const created = await client.query(
        `INSERT INTO user_cards (user_id, bank_id, label, remaining_count)
         VALUES ($1, $2, $3, 10)
         RETURNING id, bank_id, label, remaining_count, created_at, updated_at`,
        [userId, bankId, label]
      );
      cardRow = created.rows[0];
    }

    if (Number(cardRow.remaining_count) <= 0) {
      const err = new Error("no_promos_left");
      err.statusCode = 400;
      throw err;
    }

    const promoNumber = Number(cardRow.remaining_count);
    const inserted = await client.query(
      `INSERT INTO promo_uses (card_id, user_id, promo_number, used_at, place_id)
       VALUES ($1, $2, $3, $4::date, $5)
       RETURNING id, promo_number, used_at, received_at, place_id, created_at`,
      [cardRow.id, userId, promoNumber, usedDate, placeId || null]
    );

    await client.query(
      `UPDATE user_cards
       SET remaining_count = remaining_count - 1, updated_at = now()
       WHERE id = $1 AND user_id = $2`,
      [cardRow.id, userId]
    );

    const useRow = inserted.rows[0];
    const use = {
      id: useRow.id,
      promoNumber: useRow.promo_number,
      usedAt: toDateKey(useRow.used_at),
      receivedAt: null,
      placeId: useRow.place_id,
      createdAt: toIso(useRow.created_at),
    };

    // Load cards outside transaction after commit via caller path:
    return { savedCardId: cardRow.id, use };
  }).then(async ( partial) => {
    const cards = await getUserCards(userId);
    return { ...partial, cards };
  });
}

export async function markPromoUseReceived(userId, { cardId, useId, receivedAt }) {
  const receivedDate = receivedAt || todayLocalDateKey();

  if (!isPostgresEnabled()) {
    const cards = Array.isArray(userCardsStore[userId]) ? userCardsStore[userId] : [];
    const card = cards.find((c) => c.id === cardId);
    if (!card) {
      const err = new Error("card_not_found");
      err.statusCode = 404;
      throw err;
    }
    const use = (card.uses || []).find((u) => u.id === useId);
    if (!use) {
      const err = new Error("use_not_found");
      err.statusCode = 404;
      throw err;
    }
    if (!use.receivedAt) {
      use.receivedAt = receivedDate;
      persistUserCardsStoreJson();
      communityStats.promosRefundConfirmed += 1;
      communityStats.promosRefundConfirmed = Math.min(
        communityStats.promosRefundConfirmed,
        communityStats.promosRedeemed
      );
      communityStats.updatedAt = new Date().toISOString();
      persistCommunityStatsJson();
      fs.appendFileSync(
        PROMO_REFUND_REPORTS_PATH,
        JSON.stringify({
          userId,
          cardId,
          useId,
          receivedAt: receivedDate,
          usedAt: use.usedAt,
          promoNumber: use.promoNumber,
          createdAt: new Date().toISOString(),
        }) + "\n"
      );
    }
    return {
      cards: (userCardsStore[userId] || []).map(normalizeCard),
      community: await getCommunityTracker(),
    };
  }

  const updated = await withTransaction(async (client) => {
    const result = await client.query(
      `UPDATE promo_uses
       SET received_at = $1::date
       WHERE id = $2
         AND card_id = $3
         AND user_id = $4
         AND received_at IS NULL
       RETURNING id`,
      [receivedDate, useId, cardId, userId]
    );

    if (result.rowCount > 0) {
      await client.query(
        `UPDATE community_stats
         SET promos_refund_confirmed = LEAST(promos_refund_confirmed + 1, promos_redeemed)
         WHERE id = 1`
      );
    } else {
      // Distinguish missing vs already received.
      const exists = await client.query(
        `SELECT id, received_at FROM promo_uses
         WHERE id = $1 AND card_id = $2 AND user_id = $3`,
        [useId, cardId, userId]
      );
      if (!exists.rows[0]) {
        const err = new Error("use_not_found");
        err.statusCode = 404;
        throw err;
      }
    }

    return result.rowCount;
  });

  return {
    cards: await getUserCards(userId),
    community: await getCommunityTracker(),
    updated: updated > 0,
  };
}

export async function getPlaceOrderStats(placeId) {
  if (!isPostgresEnabled()) {
    const s = orderStatsByPlaceId.get(placeId) || {
      yes: 0,
      no: 0,
      lastReportedAt: null,
    };
    const total = s.yes + s.no;
    return {
      placeId,
      yes: s.yes,
      no: s.no,
      total,
      successRate: total ? s.yes / total : null,
      lastReportedAt: s.lastReportedAt,
    };
  }

  const { rows } = await query(
    `SELECT place_id, yes_count, no_count, last_reported_at
     FROM place_order_stats WHERE place_id = $1`,
    [placeId]
  );
  const row = rows[0];
  const yes = Number(row?.yes_count) || 0;
  const no = Number(row?.no_count) || 0;
  const total = yes + no;
  return {
    placeId,
    yes,
    no,
    total,
    successRate: total ? yes / total : null,
    lastReportedAt: toIso(row?.last_reported_at),
  };
}

export async function getRecentOrderReports(placeId, limit = 8) {
  const max = Math.max(1, Math.min(20, Number(limit) || 8));

  if (!isPostgresEnabled()) {
    if (!fs.existsSync(ORDER_REPORTS_PATH)) return [];
    const raw = fs.readFileSync(ORDER_REPORTS_PATH, "utf8");
    const rows = [];
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      try {
        const r = JSON.parse(line);
        if (r?.placeId !== placeId) continue;
        rows.push({
          success: !!r.success,
          issueReason: r.issueReason || null,
          device: r.device || null,
          browser: r.browser || null,
          createdAt: r.createdAt || null,
        });
      } catch {
        // ignore
      }
    }
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return rows.slice(0, max);
  }

  const { rows } = await query(
    `SELECT success, issue_reason, device, browser, created_at
     FROM order_reports
     WHERE place_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [placeId, max]
  );
  return rows.map((row) => ({
    success: !!row.success,
    issueReason: row.issue_reason || null,
    device: row.device || null,
    browser: row.browser || null,
    createdAt: toIso(row.created_at),
  }));
}

export async function getPlaceOrderFeed(placeId, limit = 8) {
  const stats = await getPlaceOrderStats(placeId);
  const recent = await getRecentOrderReports(placeId, limit);
  return { ...stats, recent };
}

export async function recordOrderReport({
  placeId,
  orderingUrl,
  success,
  cardInstitution,
  cardLabel,
  issueReason,
  device,
  browser,
  createdAt,
}) {
  const at = createdAt || new Date().toISOString();
  const safeReason =
    issueReason === "not_taking_orders" || issueReason === "paze_issues"
      ? issueReason
      : null;
  const safeDevice =
    device === "mobile" || device === "desktop" ? device : null;
  const safeBrowser = ["chrome", "firefox", "safari", "edge", "other"].includes(browser)
    ? browser
    : null;

  if (!isPostgresEnabled()) {
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
    s.lastReportedAt = at;
    orderStatsByPlaceId.set(placeId, s);
    communityStats.updatedAt = at;
    persistCommunityStatsJson();
    fs.appendFileSync(
      ORDER_REPORTS_PATH,
      JSON.stringify({
        placeId,
        orderingUrl: orderingUrl || "",
        success: !!success,
        cardInstitution: cardInstitution ?? null,
        cardLabel: cardLabel ?? null,
        issueReason: safeReason,
        device: safeDevice,
        browser: safeBrowser,
        createdAt: at,
      }) + "\n"
    );
    return {
      yes: s.yes,
      no: s.no,
      total: s.yes + s.no,
      community: await getCommunityTracker(),
    };
  }

  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO order_reports
         (place_id, ordering_url, success, card_institution, card_label,
          issue_reason, device, browser, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz)`,
      [
        placeId,
        orderingUrl || "",
        !!success,
        cardInstitution ?? null,
        cardLabel ?? null,
        safeReason,
        safeDevice,
        safeBrowser,
        at,
      ]
    );

    if (success) {
      await client.query(
        `INSERT INTO place_order_stats (place_id, yes_count, no_count, last_reported_at)
         VALUES ($1, 1, 0, $2::timestamptz)
         ON CONFLICT (place_id) DO UPDATE
           SET yes_count = place_order_stats.yes_count + 1,
               last_reported_at = EXCLUDED.last_reported_at`,
        [placeId, at]
      );
      await client.query(
        `UPDATE community_stats
         SET successful_orders = successful_orders + 1,
             promos_redeemed = promos_redeemed + 1
         WHERE id = 1`
      );
    } else {
      await client.query(
        `INSERT INTO place_order_stats (place_id, yes_count, no_count, last_reported_at)
         VALUES ($1, 0, 1, $2::timestamptz)
         ON CONFLICT (place_id) DO UPDATE
           SET no_count = place_order_stats.no_count + 1,
               last_reported_at = EXCLUDED.last_reported_at`,
        [placeId, at]
      );
      await client.query(
        `UPDATE community_stats
         SET failed_orders = failed_orders + 1
         WHERE id = 1`
      );
    }

    const stats = await client.query(
      `SELECT yes_count, no_count FROM place_order_stats WHERE place_id = $1`,
      [placeId]
    );
    const yes = Number(stats.rows[0]?.yes_count) || 0;
    const no = Number(stats.rows[0]?.no_count) || 0;
    return { yes, no, total: yes + no };
  }).then(async (place) => ({
    ...place,
    community: await getCommunityTracker(),
  }));
}

export function usesPostgres() {
  return isPostgresEnabled();
}
