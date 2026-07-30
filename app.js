const TYPE_LABELS = {
  restaurants: "Restaurants",
  retail_services: "Retail & services",
  beauty_wellness: "Beauty & wellness",
  fitness_nutrition: "Fitness & nutrition",
  arts_entertainment: "Arts & entertainment",
  specialty_lounges: "Specialty lounges",
  auto_services: "Auto services",
  body_art: "Body art",
  pet_services: "Pet services",
};

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-98.35, 39.5],
  zoom: 3.6,
  attributionControl: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), "bottom-right");

const searchInput = document.getElementById("search");
const typeSelect = document.getElementById("businessType");
const acceptingOnly = document.getElementById("acceptingOnly");
const resultsEl = document.getElementById("results");
const statEl = document.getElementById("stat");
const communityPendingCreditsEl = document.getElementById("communityPendingCredits");
const communityConfirmedCreditsEl = document.getElementById("communityConfirmedCredits");
const communityPromosReportedNEl = document.getElementById("communityPromosReportedN");
const communityStatEl = document.getElementById("communityStat");
const communityStatLabelEl = document.getElementById("communityStatLabel");
const communityStatFlipEl = document.getElementById("communityStatFlip");
const personalPendingCreditsEl = document.getElementById("personalPendingCredits");
const personalConfirmedCreditsEl = document.getElementById("personalConfirmedCredits");
const personalPromosReportedNEl = document.getElementById("personalPromosReportedN");
const personalStatsSignedInEl = document.getElementById("personalStatsSignedIn");
const personalStatsSignedOutEl = document.getElementById("personalStatsSignedOut");
const sidebarToggleEl = document.getElementById("sidebarToggle");
const sidebarPanelEl = document.getElementById("sidebarPanel");
const sidebarBackdropEl = document.getElementById("sidebarBackdrop");
const authStatusEl = document.getElementById("authStatus");
const authActionsEl = document.getElementById("authActions");
const userSummaryEl = document.getElementById("userSummary");
const userSummaryTextEl = document.getElementById("userSummaryText");
const cardManagerEl = document.getElementById("cardManager");
const cardFormToggleEl = document.getElementById("cardFormToggle");
const cardFormPanelEl = document.getElementById("cardFormPanel");
const cardsListEl = document.getElementById("cardsList");
const cardsEmptyEl = document.getElementById("cardsEmpty");
const sidebarBankGridEl = document.getElementById("sidebarBankGrid");
const sidebarCardLabelEl = document.getElementById("sidebarCardLabel");
const sidebarCardRemainingEl = document.getElementById("sidebarCardRemaining");
const historyModalEl = document.getElementById("historyModal");
const historyModalTitleEl = document.getElementById("historyModalTitle");
const historyListEl = document.getElementById("historyList");
const historyEmptyEl = document.getElementById("historyEmpty");

let historyCardId = null;
let isCardFormOpen = false;

let allFeatures = [];
let popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "300px",
  offset: 14,
});

// -----------------------------
// Order tracking modal (crowdsource)
// -----------------------------
const ORDER_PLAY_LIMIT_PER_CARD = 10;
const PZ_PROMO_VALUE_DOLLARS = 10;
const PENDING_ORDER_STORAGE_KEY = "pazetracker_pending_order_v1";

const REPORT_DEVICE_OPTIONS = [
  { id: "mobile", label: "Mobile" },
  { id: "desktop", label: "Desktop" },
];

const REPORT_BROWSER_OPTIONS = [
  { id: "chrome", label: "Chrome" },
  { id: "firefox", label: "Firefox" },
  { id: "safari", label: "Safari" },
  { id: "edge", label: "Edge" },
];

const ORDER_STEP_IDS = [
  "orderStep1",
  "orderStep2",
  "orderStepIssue",
  "orderStepIssuePaze",
  "orderStep3",
];
const USER_CARDS_STORAGE_KEY = "pazetracker_user_cards_v1";

const BANKS = [
  { id: "boa", name: "Bank of America", short: "BofA", fullRow: true },
  { id: "capital_one", name: "Capital One", short: "Cap1" },
  { id: "chase", name: "Chase", short: "Chase" },
  { id: "citi", name: "Citi", short: "Citi" },
  { id: "pnc", name: "PNC", short: "PNC" },
  { id: "truist", name: "Truist", short: "Truist" },
  { id: "us_bank", name: "U.S. Bank", short: "US Bank" },
  { id: "wells_fargo", name: "Wells Fargo", short: "Wells", fullRow: true },
  { id: "elan_financial", name: "Elan Financial Services", short: "Elan", fullRow: true },
  { id: "star_one_credit_union", name: "Star One Credit Union", short: "Star One", fullRow: true },
];

let orderModal = null;
let orderStep1El = null;
let orderStep2El = null;
let orderStepIssueEl = null;
let orderStepIssuePazeEl = null;
let orderStep3El = null;
let orderBankGridEl = null;
let orderCardLabelEl = null;
let currentPendingOrder = null;
let orderModalOpen = false;
let selectedBankId = "";
let orderReportDevice = null;
let orderReportBrowser = null;
let orderPickerSelectedCardId = null;
let orderNewCardMode = false;
let selectedSidebarBankId = BANKS[0]?.id || "";
let selectedSyncedCardId = null;
let syncedCards = [];
let authState = {
  config: null,
  clerkLoaded: false,
  clerk: null,
  user: null,
};

function getUserCards() {
  try {
    const raw = localStorage.getItem(USER_CARDS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setUserCards(cards) {
  localStorage.setItem(USER_CARDS_STORAGE_KEY, JSON.stringify(cards));
}

function clampRemaining(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 10;
  return Math.max(0, Math.min(10, Math.round(num)));
}

// Prevent crowd-report spam: cap community reports per place per day (per browser).
const USER_ORDER_REPORTS_STORAGE_KEY = "pazetracker_user_order_reports_v1";
const ORDER_REPORT_DAILY_LIMIT_PER_PLACE = 3;
const ORDER_MODAL_DISMISS_STORAGE_KEY = "pazetracker_order_modal_dismiss_v1";

function todayLocalKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getOrderReportsMap() {
  try {
    const raw = localStorage.getItem(USER_ORDER_REPORTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getOrderReportCountToday(placeId) {
  if (!placeId) return 0;
  const map = getOrderReportsMap();
  const raw = map[String(placeId)];
  const today = todayLocalKey();
  if (!raw) return 0;
  // Legacy: value was a date string when only one report per day was allowed.
  if (typeof raw === "string") return raw === today ? 1 : 0;
  if (raw.date !== today) return 0;
  return Math.max(0, Number(raw.count) || 0);
}

function canSubmitOrderReportToday(placeId) {
  return getOrderReportCountToday(placeId) < ORDER_REPORT_DAILY_LIMIT_PER_PLACE;
}

function markOrderReportSubmittedToday(placeId) {
  if (!placeId) return;
  const map = getOrderReportsMap();
  const key = String(placeId);
  const today = todayLocalKey();
  const raw = map[key];
  let count = 0;
  if (typeof raw === "string" && raw === today) count = 1;
  else if (raw && raw.date === today) count = Number(raw.count) || 0;
  map[key] = { date: today, count: count + 1 };
  localStorage.setItem(USER_ORDER_REPORTS_STORAGE_KEY, JSON.stringify(map));
}

function hasSubmittedOrderReportToday(placeId) {
  return !canSubmitOrderReportToday(placeId);
}

function getOrderModalDismissMap() {
  try {
    const raw = sessionStorage.getItem(ORDER_MODAL_DISMISS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getOrderModalDismissCount(placeId) {
  if (!placeId) return 0;
  const map = getOrderModalDismissMap();
  return Math.max(0, Number(map[String(placeId)]) || 0);
}

function markOrderModalDismissed(placeId) {
  if (!placeId) return;
  const map = getOrderModalDismissMap();
  map[String(placeId)] = getOrderModalDismissCount(placeId) + 1;
  sessionStorage.setItem(ORDER_MODAL_DISMISS_STORAGE_KEY, JSON.stringify(map));
}

function updateOrderNoButtonLabel(placeId) {
  const btn = document.getElementById("orderNoBtn");
  if (!btn) return;
  btn.textContent =
    getOrderModalDismissCount(placeId) > 0
      ? "No, still looking?"
      : "No, still browsing";
}

async function fetchAppConfig() {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("Failed to load app config");
  return res.json();
}

function loadExternalScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(existing), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    for (const [key, value] of Object.entries(attrs)) {
      if (value != null) script.setAttribute(key, value);
    }
    script.onload = () => resolve(script);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function initClerk() {
  authState.config = await fetchAppConfig();
  const clerkConfig = authState.config?.clerk || {};
  if (!clerkConfig.enabled) {
    authStatusEl.textContent = "";
    authActionsEl.hidden = true;
    userSummaryEl.hidden = true;
    cardManagerEl.hidden = true;
    return;
  }

  const scriptUrl = `https://${clerkConfig.frontendApi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
  await loadExternalScript(scriptUrl, {
    "data-clerk-publishable-key": clerkConfig.publishableKey,
    type: "text/javascript",
  });

  await window.Clerk.load();
  authState.clerk = window.Clerk;
  authState.clerkLoaded = true;
  authState.user = window.Clerk.user || null;

  window.Clerk.addListener(({ user }) => {
    authState.user = user || null;
    renderAuthUi();
    if (authState.user) loadSyncedCards().catch(console.error);
  });

  renderAuthUi();
  if (authState.user) await loadSyncedCards();
}

async function getSessionToken() {
  if (!authState.clerk?.session) return null;
  return authState.clerk.session.getToken();
}

async function authedFetch(path, options = {}) {
  const token = await getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(path, { ...options, headers });
}

function renderAuthUi() {
  const signedIn = !!authState.user;
  authActionsEl.hidden = signedIn;
  userSummaryEl.hidden = !signedIn;
  cardManagerEl.hidden = !signedIn;

  if (!authState.config?.clerk?.enabled) {
    renderPersonalStats();
    return;
  }

  if (!signedIn) {
    authStatusEl.textContent = "Sign in to sync your tracker cards across devices.";
    userSummaryTextEl.textContent = "";
    syncedCards = [];
    renderSyncedCards();
    renderPersonalStats();
    return;
  }

  authStatusEl.textContent = "";
  const displayName =
    authState.user.firstName ||
    authState.user.username ||
    authState.user.primaryEmailAddress?.emailAddress ||
    "Signed in";
  userSummaryTextEl.textContent = displayName;
  renderPersonalStats();
}

function setCardFormOpen(isOpen) {
  isCardFormOpen = !!isOpen;
  if (cardFormPanelEl) cardFormPanelEl.hidden = !isCardFormOpen;
  if (cardFormToggleEl) {
    cardFormToggleEl.setAttribute("aria-expanded", String(isCardFormOpen));
    cardFormToggleEl.classList.toggle("is-open", isCardFormOpen);
    const labelEl = cardFormToggleEl.querySelector("span");
    if (labelEl) labelEl.textContent = isCardFormOpen ? "Hide add card" : "Add a card";
  }
}

async function loadSyncedCards() {
  const res = await authedFetch("/api/user-cards");
  if (!res.ok) throw new Error("Failed to load synced cards");
  const data = await res.json();
  syncedCards = Array.isArray(data.cards) ? data.cards : [];
  if (!syncedCards.length) setCardFormOpen(true);
  renderSyncedCards();
  renderPersonalStats();
}

async function saveSyncedCard() {
  const label = (sidebarCardLabelEl?.value || "").trim();
  if (!label) {
    alert("Please enter a card label.");
    return;
  }
  const payload = {
    id: selectedSyncedCardId,
    bankId: selectedSidebarBankId,
    label,
    remainingCount: clampRemaining(sidebarCardRemainingEl?.value),
  };
  const res = await authedFetch("/api/user-cards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to save card (${res.status}) ${txt}`);
  }
  const data = await res.json();
  syncedCards = Array.isArray(data.cards) ? data.cards : [];
  selectedSyncedCardId = payload.id || data.savedCardId || null;
  setCardFormOpen(false);
  renderSyncedCards();
  renderPersonalStats();
}

function resetCardForm() {
  selectedSyncedCardId = null;
  selectedSidebarBankId = BANKS[0]?.id || "";
  if (sidebarCardLabelEl) sidebarCardLabelEl.value = "";
  if (sidebarCardRemainingEl) sidebarCardRemainingEl.value = "10";
  renderSidebarBankChoices();
  renderSyncedCards();
  setCardFormOpen(true);
}

async function deleteSyncedCard(cardId) {
  const id = String(cardId || "").trim();
  if (!id) return;
  const card = syncedCards.find((c) => String(c.id) === id);
  const label = card?.label || "this card";
  if (
    !confirm(
      `Delete “${label}”? This removes the card and its promo history from your tracker. Community totals stay the same.`
    )
  ) {
    return;
  }

  const res = await authedFetch(`/api/user-cards?cardId=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to delete card (${res.status}) ${txt}`);
  }
  const data = await res.json();
  syncedCards = Array.isArray(data.cards) ? data.cards : [];
  if (String(selectedSyncedCardId) === id) {
    selectedSyncedCardId = null;
    selectedSidebarBankId = BANKS[0]?.id || "";
    if (sidebarCardLabelEl) sidebarCardLabelEl.value = "";
    if (sidebarCardRemainingEl) sidebarCardRemainingEl.value = "10";
    renderSidebarBankChoices();
  }
  if (historyCardId && String(historyCardId) === id) closeHistoryModal();
  renderSyncedCards();
  renderPersonalStats();
}

function todayLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatDisplayDate(value) {
  if (!value) return "-";
  const [y, m, d] = String(value).split("-");
  if (!y || !m || !d) return String(value);
  return `${m}/${d}/${y}`;
}

function getCardUses(card) {
  return Array.isArray(card?.uses) ? [...card.uses] : [];
}

async function logSyncedPromoUse({ bankId, label, cardId = null, placeId = null }) {
  const res = await authedFetch("/api/user-cards/use", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cardId,
      bankId,
      label,
      placeId,
      usedAt: todayLocalDateKey(),
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to log promo use (${res.status}) ${txt}`);
  }
  const data = await res.json();
  syncedCards = Array.isArray(data.cards) ? data.cards : syncedCards;
  if (data.savedCardId) selectedSyncedCardId = data.savedCardId;
  renderSyncedCards();
  renderPersonalStats();
  return data;
}

async function markPromoUseReceived(cardId, useId, receivedAt) {
  const res = await authedFetch("/api/user-cards/use/receive", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cardId,
      useId,
      receivedAt: receivedAt || todayLocalDateKey(),
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to mark received (${res.status}) ${txt}`);
  }
  const data = await res.json();
  syncedCards = Array.isArray(data.cards) ? data.cards : syncedCards;
  if (data.community) renderCommunityStats(data.community);
  renderSyncedCards();
  renderPersonalStats();
  if (historyCardId === cardId) renderHistoryModal(cardId);
  return data;
}

function closeHistoryModal() {
  if (!historyModalEl) return;
  historyModalEl.hidden = true;
  historyModalEl.setAttribute("aria-hidden", "true");
  historyCardId = null;
}

function openHistoryModal(cardId) {
  if (!historyModalEl) return;
  historyCardId = cardId;
  historyModalEl.hidden = false;
  historyModalEl.setAttribute("aria-hidden", "false");
  renderHistoryModal(cardId);
}

function renderHistoryModal(cardId) {
  if (!historyListEl || !historyEmptyEl) return;
  const card = syncedCards.find((c) => c.id === cardId);
  if (!card) {
    closeHistoryModal();
    return;
  }

  const bank = getBankById(card.bankId);
  if (historyModalTitleEl) {
    historyModalTitleEl.textContent = `${card.label} · ${bank.name}`;
  }

  const uses = getCardUses(card).sort(
    (a, b) => b.promoNumber - a.promoNumber || String(a.usedAt).localeCompare(String(b.usedAt))
  );
  historyListEl.innerHTML = "";
  historyEmptyEl.hidden = uses.length > 0;

  for (const use of uses) {
    const row = document.createElement("div");
    row.className = "history-row";
    const received = !!use.receivedAt;
    row.innerHTML = `
      <div class="history-promo-num">#${escapeHtml(use.promoNumber)}</div>
      <div class="history-meta">
        <strong>Used ${escapeHtml(formatDisplayDate(use.usedAt))}</strong>
        <span>${
          received
            ? `Credit received ${escapeHtml(formatDisplayDate(use.receivedAt))}`
            : "Credit pending"
        }</span>
      </div>
      <div class="history-actions"></div>
    `;

    const actions = row.querySelector(".history-actions");
    if (received) {
      const status = document.createElement("div");
      status.className = "history-status-received";
      status.textContent = "Received";
      actions.appendChild(status);
    } else {
      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.value = todayLocalDateKey();
      dateInput.setAttribute("aria-label", `Received date for promo ${use.promoNumber}`);

      const markBtn = document.createElement("button");
      markBtn.type = "button";
      markBtn.className = "btn";
      markBtn.textContent = "Mark received";
      markBtn.addEventListener("click", async () => {
        try {
          markBtn.disabled = true;
          await markPromoUseReceived(card.id, use.id, dateInput.value || todayLocalDateKey());
        } catch (err) {
          alert(String(err?.message || err));
          markBtn.disabled = false;
        }
      });

      actions.appendChild(dateInput);
      actions.appendChild(markBtn);
    }

    historyListEl.appendChild(row);
  }
}

function findCard(cards, bankId, label) {
  const normalized = String(label || "").trim();
  if (!normalized) return null;
  return cards.find((c) => c.bankId === bankId && c.label === normalized) || null;
}

function getRemainingPlays(bankId, label) {
  if (authState.user) {
    const synced = findCard(syncedCards, bankId, label);
    if (synced) return clampRemaining(synced.remainingCount);
  }
  const cards = getUserCards();
  const card = findCard(cards, bankId, label);
  const used = card?.usedCount || 0;
  return Math.max(0, ORDER_PLAY_LIMIT_PER_CARD - used);
}

function setStep(stepNumber) {
  const map = {
    1: "orderStep1",
    2: "orderStep2",
    3: "orderStep3",
  };
  showOrderStep(map[stepNumber] || "orderStep1");
}

function showOrderStep(activeId) {
  for (const id of ORDER_STEP_IDS) {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== activeId;
  }
}

function detectReportDevice() {
  return window.matchMedia("(max-width: 860px)").matches ? "mobile" : "desktop";
}

function detectReportBrowser() {
  const ua = navigator.userAgent;
  if (/Edg\//i.test(ua)) return "edge";
  if (/Firefox/i.test(ua)) return "firefox";
  if (/Chrome/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua)) return "safari";
  return null;
}

function resetOrderReportMeta() {
  orderReportDevice = detectReportDevice();
  orderReportBrowser = detectReportBrowser();
  renderOrderChipRows();
}

function renderChipRow(container, options, selectedId, onSelect) {
  if (!container) return;
  container.innerHTML = "";
  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "order-chip";
    if (opt.id === selectedId) btn.classList.add("is-selected");
    btn.textContent = opt.label;
    btn.addEventListener("click", () => onSelect(opt.id));
    container.appendChild(btn);
  }
}

function renderOrderChipRows() {
  renderChipRow(
    document.getElementById("orderDeviceChips"),
    REPORT_DEVICE_OPTIONS,
    orderReportDevice,
    (id) => {
      orderReportDevice = id;
      renderOrderChipRows();
    }
  );
  renderChipRow(
    document.getElementById("orderBrowserChips"),
    REPORT_BROWSER_OPTIONS,
    orderReportBrowser,
    (id) => {
      orderReportBrowser = id;
      renderOrderChipRows();
    }
  );
  renderChipRow(
    document.getElementById("orderIssueDeviceChips"),
    REPORT_DEVICE_OPTIONS,
    orderReportDevice,
    (id) => {
      orderReportDevice = id;
      renderOrderChipRows();
    }
  );
  renderChipRow(
    document.getElementById("orderIssueBrowserChips"),
    REPORT_BROWSER_OPTIONS,
    orderReportBrowser,
    (id) => {
      orderReportBrowser = id;
      renderOrderChipRows();
    }
  );
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function capitalizeWord(value) {
  const s = String(value || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatReportText(report) {
  const time = formatRelativeTime(report?.createdAt);
  const timeSuffix = time ? ` · ${time}` : "";

  if (report?.success) {
    const parts = ["Successfully ordered using Paze"];
    if (report.browser) parts.push(`on ${capitalizeWord(report.browser)}`);
    if (report.device) parts.push(capitalizeWord(report.device));
    return `${parts.join(" ")}${timeSuffix}`;
  }

  if (report?.issueReason === "not_taking_orders") {
    return `Not taking online orders${timeSuffix}`;
  }

  if (report?.issueReason === "paze_issues") {
    let text = "Paze/checkout issues";
    if (report.browser) text += ` on ${capitalizeWord(report.browser)}`;
    if (report.device) text += ` ${capitalizeWord(report.device)}`;
    return `${text}${timeSuffix}`;
  }

  return `Issue reported${timeSuffix}`;
}

function bankShortHtml(short) {
  return escapeHtml(short).replaceAll(" ", "<br />");
}

function createBankChoiceButton(bank, { selectedId, onSelect }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "order-bank-choice";
  if (bank.fullRow) btn.classList.add("order-bank-choice--full");
  btn.dataset.bankId = bank.id;
  btn.setAttribute("aria-label", bank.name);
  btn.innerHTML = `
    <div class="order-bank-simulated-card">${bankShortHtml(bank.short)}</div>
    <div class="order-bank-name">${escapeHtml(bank.name)}</div>
  `;
  if (bank.id === selectedId) btn.classList.add("is-selected");
  btn.addEventListener("click", onSelect);
  return btn;
}

function renderBankChoices() {
  if (!orderBankGridEl) return;
  orderBankGridEl.innerHTML = "";

  for (const bank of BANKS) {
    orderBankGridEl.appendChild(
      createBankChoiceButton(bank, {
        selectedId: selectedBankId,
        onSelect: () => {
          selectedBankId = bank.id;
          renderBankChoices();
        },
      })
    );
  }
}

function renderSidebarBankChoices() {
  if (!sidebarBankGridEl) return;
  sidebarBankGridEl.innerHTML = "";

  for (const bank of BANKS) {
    sidebarBankGridEl.appendChild(
      createBankChoiceButton(bank, {
        selectedId: selectedSidebarBankId,
        onSelect: () => {
          selectedSidebarBankId = bank.id;
          renderSidebarBankChoices();
        },
      })
    );
  }
}

function getTrackableCards() {
  const fromSynced = (authState.user ? syncedCards : []).map((card) => ({
    id: String(card.id),
    bankId: card.bankId,
    label: card.label,
    remainingCount: clampRemaining(card.remainingCount),
  }));

  if (fromSynced.length) return fromSynced;

  // Guest cards (local), or signed-in fallback if sync list is empty.
  return getUserCards().map((card) => ({
    id: `${card.bankId}|${card.label}`,
    bankId: card.bankId,
    label: card.label,
    remainingCount: Math.max(
      0,
      ORDER_PLAY_LIMIT_PER_CARD - (Number(card.usedCount) || 0)
    ),
  }));
}

function setOrderNewCardMode(enabled) {
  orderNewCardMode = !!enabled;
  const listEl = document.getElementById("orderSavedCardsList");
  const emptyEl = document.getElementById("orderSavedCardsEmpty");
  const formEl = document.getElementById("orderNewCardForm");
  const toggleBtn = document.getElementById("orderAddNewCardBtn");
  const cards = getTrackableCards();

  if (listEl) listEl.hidden = orderNewCardMode || cards.length === 0;
  if (emptyEl) emptyEl.hidden = orderNewCardMode || cards.length > 0;
  if (formEl) formEl.hidden = !orderNewCardMode;
  if (toggleBtn) {
    toggleBtn.hidden = false;
    toggleBtn.textContent = orderNewCardMode
      ? cards.length
        ? "Use a saved card"
        : "Hide new card form"
      : "Add a new card";
  }
}

function renderOrderCardPicker() {
  const listEl = document.getElementById("orderSavedCardsList");
  const emptyEl = document.getElementById("orderSavedCardsEmpty");
  if (!listEl || !emptyEl) return;

  const cards = getTrackableCards();
  listEl.innerHTML = "";

  if (!cards.length) {
    emptyEl.hidden = false;
    listEl.hidden = true;
    orderPickerSelectedCardId = null;
    setOrderNewCardMode(true);
    return;
  }

  if (
    orderPickerSelectedCardId &&
    !cards.some((c) => c.id === String(orderPickerSelectedCardId))
  ) {
    orderPickerSelectedCardId = null;
  }
  if (!orderNewCardMode && !orderPickerSelectedCardId) {
    orderPickerSelectedCardId = cards[0].id;
  }

  emptyEl.hidden = true;
  listEl.hidden = orderNewCardMode;

  for (const card of cards) {
    const bank = getBankById(card.bankId);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "order-pick-card";
    if (String(card.id) === String(orderPickerSelectedCardId)) {
      btn.classList.add("is-selected");
    }
    btn.innerHTML = `
      <div class="order-bank-simulated-card">${bankShortHtml(bank.short)}</div>
      <div>
        <div class="order-pick-card-label">${escapeHtml(card.label)}</div>
        <div class="order-pick-card-meta">${escapeHtml(bank.name)} · ${card.remainingCount}/10 left</div>
      </div>
    `;
    btn.addEventListener("click", () => {
      orderPickerSelectedCardId = String(card.id);
      orderNewCardMode = false;
      renderOrderCardPicker();
    });
    listEl.appendChild(btn);
  }

  setOrderNewCardMode(orderNewCardMode);
}

async function showOrderCardStep() {
  if (authState.user) {
    try {
      await loadSyncedCards();
    } catch (err) {
      console.error("Failed to load synced cards for order modal", err);
    }
  }

  orderPickerSelectedCardId = null;
  const cards = getTrackableCards();
  orderNewCardMode = cards.length === 0;
  selectedBankId = BANKS[0]?.id || "";
  if (orderCardLabelEl) orderCardLabelEl.value = "";
  resetOrderReportMeta();
  renderBankChoices();
  renderOrderCardPicker();
  setStep(2);
}

async function confirmSuccessWithOptionalCard({ requireCard = false } = {}) {
  const p = currentPendingOrder;
  if (!p?.placeId) return;

  let bankId = null;
  let label = null;
  let cardId = null;
  let shouldTrackCard = false;

  if (orderNewCardMode) {
    label = (orderCardLabelEl?.value || "").trim();
    bankId = selectedBankId;
    if (!bankId || !label) {
      if (requireCard) {
        alert("Please enter a card label.");
        return;
      }
    } else {
      shouldTrackCard = true;
    }
  } else if (orderPickerSelectedCardId) {
    const picked = getTrackableCards().find(
      (c) => String(c.id) === String(orderPickerSelectedCardId)
    );
    if (picked) {
      bankId = picked.bankId;
      label = picked.label;
      if (authState.user) cardId = picked.id;
      shouldTrackCard = true;
    } else if (requireCard) {
      alert("Please choose a card.");
      return;
    }
  } else if (requireCard) {
    alert("Please choose a card.");
    return;
  }

  try {
    if (shouldTrackCard && bankId && label) {
      if (authState.user) {
        await logSyncedPromoUse({
          cardId,
          bankId,
          label,
          placeId: p.placeId,
        });
      } else {
        const cards = getUserCards();
        let card = findCard(cards, bankId, label);
        if (!card) {
          card = { bankId, label, usedCount: 0 };
          cards.push(card);
        }
        card.usedCount = (card.usedCount || 0) + 1;
        setUserCards(cards);
      }
    }

    if (!hasSubmittedOrderReportToday(p.placeId)) {
      await submitOrderReport({
        placeId: p.placeId,
        orderingUrl: p.orderingUrl,
        success: true,
        bankId: shouldTrackCard ? bankId : null,
        cardLabel: shouldTrackCard ? label : null,
        device: orderReportDevice,
        browser: orderReportBrowser,
      });
      markOrderReportSubmittedToday(p.placeId);
    } else if (shouldTrackCard) {
      await redeemCommunityPromo(1);
    } else {
      // Already reported today; nothing else required.
    }
  } catch (e) {
    alert(String(e?.message || e));
    return;
  }

  setStep(3);
}

function getBankById(bankId) {
  return BANKS.find((b) => b.id === bankId) || BANKS[0];
}

function renderSyncedCards() {
  if (!cardsListEl || !cardsEmptyEl) return;
  cardsListEl.innerHTML = "";
  cardsEmptyEl.hidden = syncedCards.length > 0;
  if (!syncedCards.length) setCardFormOpen(true);

  for (const card of syncedCards) {
    const bank = getBankById(card.bankId);
    const uses = getCardUses(card);
    const pendingCredits = uses.filter((u) => !u.receivedAt).length;
    const item = document.createElement("div");
    item.className = "saved-card";
    if (card.id === selectedSyncedCardId) item.classList.add("is-selected");
    item.innerHTML = `
      <div class="saved-card-row">
        <button type="button" class="saved-card-select" aria-label="Select ${escapeHtml(card.label)}">
          <div class="saved-card-top">
            <div class="order-bank-simulated-card">${bankShortHtml(bank.short)}</div>
            <div class="saved-card-copy">
              <span class="saved-card-label">${escapeHtml(card.label)}</span>
              <span class="saved-card-bank">${escapeHtml(bank.name)}</span>
              <span class="saved-card-remaining">${clampRemaining(card.remainingCount)}/10 promos left${
                pendingCredits ? ` · ${pendingCredits} pending credit${pendingCredits === 1 ? "" : "s"}` : ""
              }</span>
            </div>
          </div>
        </button>
        <button type="button" class="saved-card-delete" aria-label="Delete ${escapeHtml(card.label)}" title="Delete card">×</button>
      </div>
      <div class="saved-card-actions">
        <button type="button" class="btn btn-ghost history-btn">History</button>
      </div>
    `;

    item.querySelector(".saved-card-select")?.addEventListener("click", () => {
      selectedSyncedCardId = card.id;
      selectedSidebarBankId = card.bankId;
      if (sidebarCardLabelEl) sidebarCardLabelEl.value = card.label;
      if (sidebarCardRemainingEl) sidebarCardRemainingEl.value = String(clampRemaining(card.remainingCount));
      renderSidebarBankChoices();
      renderSyncedCards();
    });

    item.querySelector(".history-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      openHistoryModal(card.id);
    });

    item.querySelector(".saved-card-delete")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        await deleteSyncedCard(card.id);
      } catch (err) {
        console.error(err);
        alert(err?.message || "Failed to delete card.");
      }
    });

    cardsListEl.appendChild(item);
  }
}

async function submitOrderReport({
  placeId,
  orderingUrl,
  success,
  bankId,
  cardLabel,
  issueReason,
  device,
  browser,
}) {
  if (!placeId) return null;
  const payload = {
    placeId,
    orderingUrl: orderingUrl || "",
    success: !!success,
    cardInstitution: bankId || null,
    cardLabel: cardLabel || null,
    issueReason: issueReason || null,
    device: device || null,
    browser: browser || null,
    createdAt: new Date().toISOString(),
  };

  const res = await fetch("/api/order-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Order report failed (${res.status}) ${txt}`);
  }

  const data = await res.json().catch(() => null);
  if (data?.community) renderCommunityStats(data.community);
  refreshCommunityFeed(placeId);
  return data;
}

async function submitIssueOrderReport(p, issueReason) {
  if (!p?.placeId) return;
  if (hasSubmittedOrderReportToday(p.placeId)) return;
  await submitOrderReport({
    placeId: p.placeId,
    orderingUrl: p.orderingUrl,
    success: false,
    issueReason,
    device: issueReason === "paze_issues" ? orderReportDevice : null,
    browser: issueReason === "paze_issues" ? orderReportBrowser : null,
  });
  markOrderReportSubmittedToday(p.placeId);
}

async function redeemCommunityPromo(count = 1) {
  const res = await fetch("/api/promo-redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data) renderCommunityStats(data);
  return data;
}

function renderCommunityStats(stats) {
  if (!communityPendingCreditsEl || !communityConfirmedCreditsEl || !communityPromosReportedNEl)
    return;

  const pendingDollars = Number(stats?.pendingCreditsDollars);
  const confirmedDollars = Number(stats?.confirmedCreditsDollars);
  const promosRedeemed = Number(stats?.promosRedeemed);

  communityPendingCreditsEl.textContent = Number.isFinite(pendingDollars)
    ? `$${pendingDollars.toLocaleString()}`
    : "-";
  communityConfirmedCreditsEl.textContent = Number.isFinite(confirmedDollars)
    ? `$${confirmedDollars.toLocaleString()}`
    : "-";
  communityPromosReportedNEl.textContent = Number.isFinite(promosRedeemed)
    ? promosRedeemed.toLocaleString()
    : "-";
}

function computePersonalPromoStats() {
  let pending = 0;
  let confirmed = 0;
  for (const card of syncedCards) {
    for (const use of getCardUses(card)) {
      if (use.receivedAt) confirmed += 1;
      else pending += 1;
    }
  }
  return {
    pending,
    confirmed,
    total: pending + confirmed,
    pendingCreditsDollars: pending * PZ_PROMO_VALUE_DOLLARS,
    confirmedCreditsDollars: confirmed * PZ_PROMO_VALUE_DOLLARS,
  };
}

function renderPersonalStats() {
  const signedIn = !!authState.user;
  if (personalStatsSignedInEl) personalStatsSignedInEl.hidden = !signedIn;
  if (personalStatsSignedOutEl) personalStatsSignedOutEl.hidden = signedIn;

  if (!signedIn) {
    if (personalPendingCreditsEl) personalPendingCreditsEl.textContent = "-";
    if (personalConfirmedCreditsEl) personalConfirmedCreditsEl.textContent = "-";
    if (personalPromosReportedNEl) personalPromosReportedNEl.textContent = "-";
    return;
  }

  const stats = computePersonalPromoStats();
  if (personalPendingCreditsEl) {
    personalPendingCreditsEl.textContent = `$${stats.pendingCreditsDollars.toLocaleString()}`;
  }
  if (personalConfirmedCreditsEl) {
    personalConfirmedCreditsEl.textContent = `$${stats.confirmedCreditsDollars.toLocaleString()}`;
  }
  if (personalPromosReportedNEl) {
    personalPromosReportedNEl.textContent = stats.total.toLocaleString();
  }
}

function setCommunityStatFlipped(isFlipped) {
  if (!communityStatEl || !communityStatFlipEl) return;
  communityStatEl.classList.toggle("is-flipped", !!isFlipped);
  const showingPersonal = !!isFlipped;
  if (communityStatLabelEl) {
    communityStatLabelEl.textContent = showingPersonal
      ? "Your promo credits"
      : "Community promo credits";
  }
  communityStatFlipEl.setAttribute(
    "aria-label",
    showingPersonal ? "Show community promo stats" : "Show your promo stats"
  );
  communityStatFlipEl.title = showingPersonal ? "Flip to community" : "Flip to your stats";

  const backFace = communityStatEl.querySelector(".community-stat-face--back");
  const frontFace = communityStatEl.querySelector(".community-stat-face--front");
  if (backFace) backFace.setAttribute("aria-hidden", showingPersonal ? "false" : "true");
  if (frontFace) frontFace.setAttribute("aria-hidden", showingPersonal ? "true" : "false");
}

communityStatFlipEl?.addEventListener("click", () => {
  const next = !communityStatEl?.classList.contains("is-flipped");
  setCommunityStatFlipped(next);
  if (next) renderPersonalStats();
});

async function loadCommunityStats() {
  const res = await fetch("/api/community-stats");
  if (!res.ok) return;
  const data = await res.json();
  renderCommunityStats(data);
}

async function openOrderModalFromPending() {
  if (orderModalOpen) return;

  const raw = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
  if (!raw) return;

  try {
    currentPendingOrder = JSON.parse(raw);
  } catch {
    return;
  }
  if (!currentPendingOrder?.placeId) return;

  orderModalOpen = true;
  awaitingOrderReturn = false;
  sawLeaveForOrder = false;
  if (orderReturnWatchTimer) {
    clearInterval(orderReturnWatchTimer);
    orderReturnWatchTimer = null;
  }
  sessionStorage.setItem(ORDER_MODAL_OPEN_STORAGE_KEY, "1");

  if (orderModal) {
    orderModal.hidden = false;
    orderModal.setAttribute("aria-hidden", "false");
  }

  selectedBankId = BANKS[0]?.id || "";
  if (orderCardLabelEl) orderCardLabelEl.value = "";
  resetOrderReportMeta();
  updateOrderNoButtonLabel(currentPendingOrder.placeId);
  showOrderStep("orderStep1");
}

function closeOrderModal({ keepPending = false } = {}) {
  if (orderModal) {
    orderModal.hidden = true;
    orderModal.setAttribute("aria-hidden", "true");
  }
  orderModalOpen = false;
  awaitingOrderReturn = false;
  sawLeaveForOrder = false;
  if (orderReturnWatchTimer) {
    clearInterval(orderReturnWatchTimer);
    orderReturnWatchTimer = null;
  }
  sessionStorage.removeItem(ORDER_MODAL_OPEN_STORAGE_KEY);
  if (!keepPending) sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
  currentPendingOrder = null;
}

function wireOrderModalUi() {
  orderModal = document.getElementById("orderModal");
  orderStep1El = document.getElementById("orderStep1");
  orderStep2El = document.getElementById("orderStep2");
  orderStepIssueEl = document.getElementById("orderStepIssue");
  orderStepIssuePazeEl = document.getElementById("orderStepIssuePaze");
  orderStep3El = document.getElementById("orderStep3");
  orderBankGridEl = document.getElementById("orderBankGrid");
  orderCardLabelEl = document.getElementById("orderCardLabel");

  if (!orderModal || !orderStep1El) return;

  document.getElementById("orderModalClose")?.addEventListener("click", () => closeOrderModal());
  document.getElementById("orderYesBtn")?.addEventListener("click", () => {
    showOrderCardStep().catch((e) => alert(String(e?.message || e)));
  });
  document.getElementById("orderNoBtn")?.addEventListener("click", () => {
    const placeId = currentPendingOrder?.placeId;
    if (placeId) markOrderModalDismissed(placeId);
    closeOrderModal();
  });
  document.getElementById("orderReportIssueBtn")?.addEventListener("click", () => {
    resetOrderReportMeta();
    showOrderStep("orderStepIssue");
  });
  document.getElementById("orderAddNewCardBtn")?.addEventListener("click", () => {
    const cards = getTrackableCards();
    if (orderNewCardMode && cards.length) {
      orderNewCardMode = false;
      if (!orderPickerSelectedCardId) orderPickerSelectedCardId = cards[0].id;
    } else {
      orderNewCardMode = true;
      orderPickerSelectedCardId = null;
    }
    renderOrderCardPicker();
  });
  document.getElementById("orderIssueNotTakingBtn")?.addEventListener("click", async () => {
    const p = currentPendingOrder;
    if (!p?.placeId) return;
    try {
      await submitIssueOrderReport(p, "not_taking_orders");
      showOrderStep("orderStep3");
    } catch (e) {
      alert(String(e?.message || e));
    }
  });
  document.getElementById("orderIssuePazeBtn")?.addEventListener("click", () => {
    resetOrderReportMeta();
    showOrderStep("orderStepIssuePaze");
  });
  document.getElementById("orderIssueSubmitBtn")?.addEventListener("click", async () => {
    const p = currentPendingOrder;
    if (!p?.placeId) return;
    try {
      await submitIssueOrderReport(p, "paze_issues");
      showOrderStep("orderStep3");
    } catch (e) {
      alert(String(e?.message || e));
    }
  });
  document.getElementById("orderSubmitBtn")?.addEventListener("click", async () => {
    await confirmSuccessWithOptionalCard({
      requireCard: orderNewCardMode,
    });
  });
  document.getElementById("orderSkipCardBtn")?.addEventListener("click", async () => {
    orderNewCardMode = false;
    orderPickerSelectedCardId = null;
    await confirmSuccessWithOptionalCard({ requireCard: false });
  });
  document.getElementById("orderDoneBtn")?.addEventListener("click", () => closeOrderModal());
}

document.getElementById("historyModalClose")?.addEventListener("click", () => closeHistoryModal());
historyModalEl?.addEventListener("click", (e) => {
  if (e.target === historyModalEl) closeHistoryModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && historyModalEl && !historyModalEl.hidden) {
    closeHistoryModal();
  }
});

function safeDomId(placeId) {
  return `community_${placeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function refreshCommunityFeed(placeId) {
  if (!placeId) return;
  const popupEl = popup.getElement();
  if (!popupEl) return;

  const block = popupEl.querySelector(`#${safeDomId(placeId)}`);
  if (!block) return;

  const summaryEl = block.querySelector(".popup-community-summary");
  const toggleEl = block.querySelector(".popup-reports-toggle");
  const listEl = block.querySelector(".popup-reports-list");
  if (summaryEl) summaryEl.textContent = "Community: loading...";

  const res = await fetch(`/api/order-report-stats?placeId=${encodeURIComponent(placeId)}`);
  if (!res.ok) return;
  const feed = await res.json();

  if (!feed?.total) {
    if (summaryEl) summaryEl.textContent = "Community: no reports yet";
    if (toggleEl) toggleEl.hidden = true;
    if (listEl) {
      listEl.hidden = true;
      listEl.innerHTML = "";
    }
    return;
  }

  const pct = Math.round((feed.yes / feed.total) * 100);
  if (summaryEl) {
    summaryEl.textContent = `Community: ${pct}% success (${feed.yes} yes / ${feed.no} no)`;
  }

  const recent = Array.isArray(feed.recent) ? feed.recent : [];
  if (!toggleEl || !listEl) return;

  if (!recent.length) {
    toggleEl.hidden = true;
    listEl.hidden = true;
    listEl.innerHTML = "";
    return;
  }

  toggleEl.hidden = false;
  toggleEl.textContent = "Recent community reports";
  toggleEl.setAttribute("aria-expanded", "false");
  listEl.hidden = true;
  listEl.innerHTML = recent
    .map((report) => {
      const tone = report.success ? "positive" : "negative";
      return `<li class="popup-report popup-report--${tone}">${escapeHtml(formatReportText(report))}</li>`;
    })
    .join("");

  toggleEl.onclick = () => {
    const open = listEl.hidden;
    listEl.hidden = !open;
    toggleEl.setAttribute("aria-expanded", String(open));
  };
}

const ORDER_MODAL_OPEN_STORAGE_KEY = "pazetracker_order_modal_open_v1";
let awaitingOrderReturn = false;
let sawLeaveForOrder = false;
let orderReturnWatchTimer = null;

function markPendingOrder(placeId, orderingUrl) {
  if (!placeId || !orderingUrl) return;
  // Fresh page loads never have the modal open — clear any stuck flag from a prior session.
  sessionStorage.removeItem(ORDER_MODAL_OPEN_STORAGE_KEY);
  orderModalOpen = false;
  sessionStorage.setItem(
    PENDING_ORDER_STORAGE_KEY,
    JSON.stringify({ placeId, orderingUrl, at: Date.now() })
  );
  awaitingOrderReturn = true;
  sawLeaveForOrder = false;
  startOrderReturnWatch();
}

function noteLeftForOrder() {
  if (!awaitingOrderReturn) return;
  sawLeaveForOrder = true;
}

function startOrderReturnWatch() {
  if (orderReturnWatchTimer) clearInterval(orderReturnWatchTimer);
  const startedAt = Date.now();
  orderReturnWatchTimer = setInterval(() => {
    if (!awaitingOrderReturn || Date.now() - startedAt > 30 * 60 * 1000) {
      clearInterval(orderReturnWatchTimer);
      orderReturnWatchTimer = null;
      return;
    }
    if (
      sawLeaveForOrder &&
      document.visibilityState === "visible" &&
      document.hasFocus()
    ) {
      checkPendingOrder();
    }
  }, 700);
}

function wireOrderingLinkHandler(p) {
  const popupEl = popup.getElement();
  const link = popupEl?.querySelector(".ordering-link");
  if (!link) return;
  link.addEventListener("click", () => {
    markPendingOrder(p?.id, p?.orderingUrl);
  });
}

function typeLabel(key) {
  return TYPE_LABELS[key] || key.replaceAll("_", " ");
}

function matchesFilters(props, query) {
  if (acceptingOnly.checked && props.orderingStatus === "closed") return false;

  const selectedType = typeSelect.value;
  if (selectedType && props.businessType !== selectedType) return false;

  if (!query) return true;
  const hay = `${props.name} ${props.city} ${props.state} ${props.address}`.toLowerCase();
  return query.split(/\s+/).every((token) => hay.includes(token));
}

function filteredCollection() {
  const query = searchInput.value.trim().toLowerCase();
  return {
    type: "FeatureCollection",
    features: allFeatures.filter((f) => matchesFilters(f.properties, query)),
  };
}

function updateStat(count) {
  statEl.innerHTML = `<strong>${count.toLocaleString()}</strong> merchants shown`;
}

function getSearchPreviewKey(feature) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  return p.id || `${p.name}-${lat}-${lng}`;
}

async function loadPlacePreview(feature) {
  const key = getSearchPreviewKey(feature);
  if (loadPlacePreview._cache?.has(key)) {
    return loadPlacePreview._cache.get(key);
  }

  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const params = new URLSearchParams({
    name: p.name || "",
    address: p.address || "",
    city: p.city || "",
    state: p.state || "",
    lat: String(lat),
    lng: String(lng),
  });

  const res = await fetch(`/api/place-photos?${params}`);
  const data = await res.json();
  if (!loadPlacePreview._cache) loadPlacePreview._cache = new Map();
  loadPlacePreview._cache.set(key, data);
  return data;
}

function buildSearchPreviewHtml(preview) {
  const thumb = preview?.all?.[0]
    ? `<img class="results-thumb" src="${escapeHtml(preview.all[0])}" alt="" loading="lazy" />`
    : `<div class="results-thumb results-thumb--placeholder" aria-hidden="true"></div>`;

  const rating =
    typeof preview?.rating === "number"
      ? `<span class="results-rating">★ ${preview.rating.toFixed(1)}${typeof preview?.userRatingCount === "number" ? ` (${preview.userRatingCount})` : ""}</span>`
      : `<span class="results-rating results-rating--muted">No rating</span>`;

  return `${thumb}<div class="results-preview-meta">${rating}</div>`;
}

function renderResults(collection) {
  const query = searchInput.value.trim();
  if (!query) {
    resultsEl.hidden = true;
    resultsEl.innerHTML = "";
    return;
  }

  const hits = collection.features.slice(0, 40);
  resultsEl.hidden = hits.length === 0;
  resultsEl.innerHTML = hits
    .map((f, i) => {
      const p = f.properties;
      const previewKey = escapeHtml(getSearchPreviewKey(f));
      return `<li tabindex="0" data-index="${i}">
        <div class="results-row">
          <div class="results-preview" data-preview-key="${previewKey}">
            <div class="results-thumb results-thumb--placeholder" aria-hidden="true"></div>
            <div class="results-preview-meta">
              <span class="results-rating results-rating--muted">Loading...</span>
            </div>
          </div>
          <div class="results-copy">
            <span class="name">${escapeHtml(p.name)}</span>
            <span class="meta">${escapeHtml([p.city, p.state].filter(Boolean).join(", "))} · ${escapeHtml(typeLabel(p.businessType))}</span>
          </div>
        </div>
      </li>`;
    })
    .join("");

  resultsEl.querySelectorAll("li").forEach((li) => {
    const focus = () => {
      const feature = hits[Number(li.dataset.index)];
      flyToFeature(feature);
      showPopup(feature);
    };
    li.addEventListener("click", focus);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        focus();
      }
    });
  });

  // Lazy-enrich top search results with Google thumbnails + ratings.
  hits.slice(0, 12).forEach((feature) => {
    const previewKey = getSearchPreviewKey(feature);
    const container = resultsEl.querySelector(`[data-preview-key="${CSS.escape(previewKey)}"]`);
    if (!container) return;

    loadPlacePreview(feature)
      .then((preview) => {
        if (!container.isConnected) return;
        container.innerHTML = buildSearchPreviewHtml(preview);
      })
      .catch(() => {
        if (!container.isConnected) return;
        container.innerHTML = `
          <div class="results-thumb results-thumb--placeholder" aria-hidden="true"></div>
          <div class="results-preview-meta">
            <span class="results-rating results-rating--muted">Preview unavailable</span>
          </div>
        `;
      });
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function applyFilters() {
  const collection = filteredCollection();
  if (map.getSource("merchants")) {
    map.getSource("merchants").setData(collection);
  }
  updateStat(collection.features.length);
  renderResults(collection);
}

function flyToFeature(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 14), speed: 1.2 });
}

function buildPhotoGalleryHtml(photos, activeIndex = 0) {
  if (!photos.length) {
    return `<div class="popup-gallery popup-gallery--empty" aria-hidden="true"></div>`;
  }
  const safe = photos.slice(0, 12);
  const main = safe[activeIndex] || safe[0];
  const thumbs =
    safe.length > 1
      ? safe
          .map((url, i) => {
            const active = i === activeIndex ? " is-active" : "";
            return `<button type="button" class="popup-thumb${active}" data-photo-index="${i}" aria-label="Photo ${i + 1}">
        <img src="${escapeHtml(url)}" alt="" loading="lazy" />
      </button>`;
          })
          .join("")
      : "";

  return `
    <div class="popup-gallery" data-photo-count="${safe.length}">
      <div class="popup-hero">
        <img class="popup-hero-img" src="${escapeHtml(main)}" alt="" />
      </div>
      <div class="popup-thumbs" role="list">${thumbs}</div>
    </div>`;
}

function wirePopupGallery(container) {
  const gallery = container.querySelector(".popup-gallery");
  if (!gallery || gallery.classList.contains("popup-gallery--empty")) return;

  const heroImg = gallery.querySelector(".popup-hero-img");
  gallery.querySelectorAll(".popup-thumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const img = btn.querySelector("img");
      if (!img || !heroImg) return;
      gallery.querySelectorAll(".popup-thumb").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      heroImg.src = img.src;
    });
  });
}

async function loadPlaceImages(feature) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
  const key = p.id || `${p.name}-${lat}-${lng}`;
  if (loadPlaceImages._cache?.has(key)) {
    return loadPlaceImages._cache.get(key);
  }

  const params = new URLSearchParams({
    name: p.name || "",
    address: p.address || "",
    city: p.city || "",
    state: p.state || "",
    lat: String(lat),
    lng: String(lng),
  });
  const res = await fetch(`/api/place-photos?${params}`);
  const data = await res.json();
  if (!res.ok && res.status !== 503) throw new Error("Image fetch failed");
  if (!loadPlaceImages._cache) loadPlaceImages._cache = new Map();
  loadPlaceImages._cache.set(key, data);
  return data;
}

function buildPopupInnerHtml(p, photoState) {
  const placeId = p.id || "";
  const communityDomId = placeId
    ? `community_${placeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : "";

  const badges = [
    `<span class="badge">${escapeHtml(typeLabel(p.businessType))}</span>`,
  ];
  if (p.giftCard === true || p.giftCard === "true") {
    badges.push(`<span class="badge">Gift cards</span>`);
  }
  if (p.orderingStatus === "closed") {
    badges.push(`<span class="badge warn">Orders paused</span>`);
  }

  const statusNote = p.orderingStatusMessage
    ? `<p>${escapeHtml(p.orderingStatusMessage)}</p>`
    : "";
  const link = p.orderingUrl
    ? `<a href="${escapeHtml(p.orderingUrl)}" target="_blank" rel="noopener noreferrer" class="ordering-link" data-place-id="${escapeHtml(placeId)}" data-ordering-url="${escapeHtml(p.orderingUrl)}">Open Clover ordering -></a>`
    : "";

  const community = communityDomId
    ? `<div class="popup-community-block" id="${communityDomId}">
        <p class="popup-community-summary">Community: -</p>
        <button type="button" class="popup-reports-toggle" hidden>
          Recent community reports
        </button>
        <ul class="popup-reports-list" hidden></ul>
      </div>`
    : "";

  let galleryBlock;
  if (photoState === "loading") {
    galleryBlock = `<div class="popup-gallery popup-gallery--loading"><span>Loading photos…</span></div>`;
  } else if (photoState === "error") {
    galleryBlock = `<div class="popup-gallery popup-gallery--empty"><span class="popup-gallery-note">Photos not available</span></div>`;
  } else if (photoState?.error === "missing_api_key") {
    galleryBlock = `<div class="popup-gallery popup-gallery--empty"><span class="popup-gallery-note">Add GOOGLE_MAPS_API_KEY to .env for photos</span></div>`;
  } else if (!photoState?.all?.length) {
    galleryBlock = `<div class="popup-gallery popup-gallery--empty"><span class="popup-gallery-note">No Google photos found</span></div>`;
  } else {
    galleryBlock = buildPhotoGalleryHtml(photoState.all);
    if (photoState.provider === "google") {
      galleryBlock += `<p class="popup-photos-credit">Photos via Google</p>`;
    }
  }

  return `
    <div class="popup">
      ${galleryBlock}
      <div class="popup-body">
        <h2>${escapeHtml(p.name)}</h2>
        ${badges.join("")}
        <p>${escapeHtml(p.address || [p.city, p.state].filter(Boolean).join(", "))}</p>
        ${statusNote}
        ${community}
        ${link}
      </div>
    </div>`;
}

function wirePopupAfterHtmlUpdate(p) {
  const popupEl = popup.getElement();
  if (!popupEl) return;
  wirePopupGallery(popupEl);
  wireOrderingLinkHandler(p);
  refreshCommunityFeed(p.id);
}

function showPopup(feature) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;

  popup
    .setLngLat([lng, lat])
    .setHTML(buildPopupInnerHtml(p, "loading"))
    .addTo(map);

  wirePopupAfterHtmlUpdate(p);

  loadPlaceImages(feature)
    .then((data) => {
      if (!popup.isOpen()) return;
      popup.setHTML(buildPopupInnerHtml(p, data));
      wirePopupAfterHtmlUpdate(p);
    })
    .catch(() => {
      if (!popup.isOpen()) return;
      popup.setHTML(buildPopupInnerHtml(p, "error"));
      wirePopupAfterHtmlUpdate(p);
    });
}

function populateTypeOptions(features) {
  const counts = new Map();
  for (const f of features) {
    const key = f.properties.businessType || "restaurants";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const preferred = [
    "restaurants",
    "retail_services",
    "beauty_wellness",
    "fitness_nutrition",
    "arts_entertainment",
    "specialty_lounges",
    "auto_services",
    "body_art",
    "pet_services",
  ];

  const keys = [
    ...preferred.filter((k) => counts.has(k)),
    ...[...counts.keys()].filter((k) => !preferred.includes(k)).sort(),
  ];

  for (const key of keys) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${typeLabel(key)} (${counts.get(key).toLocaleString()})`;
    typeSelect.appendChild(opt);
  }
}

function addMerchantLayers() {
  map.addSource("merchants", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 12,
    clusterRadius: 52,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "merchants",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#7bb8ad",
        25,
        "#3f917f",
        100,
        "#0f6b5c",
        500,
        "#084a3f",
      ],
      "circle-radius": [
        "step",
        ["get", "point_count"],
        16,
        25,
        20,
        100,
        26,
        500,
        34,
      ],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "merchants",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Bold"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  map.addLayer({
    id: "unclustered",
    type: "circle",
    source: "merchants",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#c45c26",
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.on("click", "clusters", async (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
    const clusterId = features[0].properties.cluster_id;
    const source = map.getSource("merchants");
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center: features[0].geometry.coordinates,
      zoom,
    });
  });

  map.on("click", "unclustered", (e) => {
    const feature = e.features[0];
    showPopup(feature);
  });

  map.on("mouseenter", "clusters", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "clusters", () => {
    map.getCanvas().style.cursor = "";
  });
  map.on("mouseenter", "unclustered", () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", "unclustered", () => {
    map.getCanvas().style.cursor = "";
  });
}

async function loadData() {
  const [geoRes, metaRes] = await Promise.all([
    fetch("./data/clover-merchants.geojson"),
    fetch("./data/meta.json"),
  ]);
  if (!geoRes.ok) throw new Error("Failed to load merchant GeoJSON");
  const geojson = await geoRes.json();
  allFeatures = geojson.features || [];
  populateTypeOptions(allFeatures);

  if (metaRes.ok) {
    const meta = await metaRes.json();
    console.info("Merchant data", meta);
  }

  applyFilters();
}

searchInput.addEventListener("input", () => {
  window.clearTimeout(searchInput._t);
  searchInput._t = window.setTimeout(applyFilters, 120);
});
typeSelect.addEventListener("change", applyFilters);
acceptingOnly.addEventListener("change", applyFilters);

document.getElementById("reset").addEventListener("click", () => {
  searchInput.value = "";
  typeSelect.value = "";
  acceptingOnly.checked = false;
  applyFilters();
  map.flyTo({ center: [-98.35, 39.5], zoom: 3.6 });
  popup.remove();
});

function geolocationErrorMessage(err) {
  if (!window.isSecureContext) {
    return "Location needs a secure (https) connection. Open the site over https and try again.";
  }
  switch (err?.code) {
    case 1: // PERMISSION_DENIED
      return "Location permission is blocked. On iPhone: tap Aa in the address bar → Website Settings → Location → Allow, or Settings → Safari → Location, then try Near me again.";
    case 2: // POSITION_UNAVAILABLE
      return "Location is unavailable. Turn on Location Services (Settings → Privacy & Security → Location Services) and try again.";
    case 3: // TIMEOUT
      return "Timed out getting your location. Move somewhere with a clearer signal and try again.";
    default:
      return "Could not get your location.";
  }
}

function getBrowserPosition(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

document.getElementById("locate").addEventListener("click", async () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not available in this browser.");
    return;
  }
  if (!window.isSecureContext) {
    alert(geolocationErrorMessage({ code: -1 }));
    return;
  }

  const btn = document.getElementById("locate");
  const prevLabel = btn?.textContent || "Near me";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Locating…";
  }

  try {
    let pos;
    try {
      // Safari often fails high-accuracy GPS indoors; try network/wifi first.
      pos = await getBrowserPosition({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60_000,
      });
    } catch (firstErr) {
      if (firstErr?.code === 1) throw firstErr;
      pos = await getBrowserPosition({
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 0,
      });
    }

    map.flyTo({
      center: [pos.coords.longitude, pos.coords.latitude],
      zoom: 11.5,
      speed: 1.4,
    });

    if (isMobileSidebar()) setSidebarOpen(false);
  } catch (err) {
    console.warn("geolocation failed", err);
    alert(geolocationErrorMessage(err));
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }
});

document.getElementById("signInBtn")?.addEventListener("click", async () => {
  if (!authState.clerk) return;
  await authState.clerk.openSignIn();
});

document.getElementById("signUpBtn")?.addEventListener("click", async () => {
  if (!authState.clerk) return;
  await authState.clerk.openSignUp();
});

document.getElementById("signOutBtn")?.addEventListener("click", async () => {
  if (!authState.clerk) return;
  await authState.clerk.signOut();
  syncedCards = [];
  resetCardForm();
});

document.getElementById("saveCardBtn")?.addEventListener("click", async () => {
  try {
    await saveSyncedCard();
  } catch (err) {
    alert(String(err?.message || err));
  }
});

document.getElementById("newCardBtn")?.addEventListener("click", () => {
  resetCardForm();
});

cardFormToggleEl?.addEventListener("click", () => {
  setCardFormOpen(!isCardFormOpen);
});

map.on("load", async () => {
  addMerchantLayers();
  loadCommunityStats().catch(console.error);
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    statEl.textContent = "Could not load merchant data.";
  }
});

wireOrderModalUi();

// After a reload the DOM modal is closed, but this flag can linger and block reopen.
sessionStorage.removeItem(ORDER_MODAL_OPEN_STORAGE_KEY);

function checkPendingOrder() {
  if (orderModalOpen) return;
  if (sessionStorage.getItem(ORDER_MODAL_OPEN_STORAGE_KEY) === "1") return;
  const raw = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
  if (!raw) return;

  // Avoid "stuck" modal if pending state is stale (e.g. page refresh).
  try {
    const pending = JSON.parse(raw);
    if (pending?.at && Date.now() - pending.at > 10 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      awaitingOrderReturn = false;
      return;
    }
  } catch {
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    awaitingOrderReturn = false;
    return;
  }

  openOrderModalFromPending();
}

let hasBeenHiddenSinceLoad = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    hasBeenHiddenSinceLoad = true;
    noteLeftForOrder();
  }
  if (document.visibilityState === "visible" && hasBeenHiddenSinceLoad) {
    hasBeenHiddenSinceLoad = false;
    checkPendingOrder();
  }
});

let hasLostFocusSinceLoad = false;
window.addEventListener("blur", () => {
  hasLostFocusSinceLoad = true;
  noteLeftForOrder();
});
window.addEventListener("focus", () => {
  if (!hasLostFocusSinceLoad) return;
  hasLostFocusSinceLoad = false;
  checkPendingOrder();
});

window.addEventListener("pageshow", (event) => {
  // Only on back/forward cache restore — never on a normal refresh/load.
  if (event.persisted) checkPendingOrder();
});

function setSidebarOpen(isOpen) {
  if (!sidebarPanelEl || !sidebarToggleEl || !sidebarBackdropEl) return;
  const open = !!isOpen;
  sidebarPanelEl.classList.toggle("is-open", open);
  sidebarBackdropEl.hidden = !open;
  sidebarToggleEl.setAttribute("aria-expanded", String(open));
  sidebarToggleEl.setAttribute("aria-label", open ? "Close controls" : "Open controls");
}

function isMobileSidebar() {
  return window.matchMedia("(max-width: 860px)").matches;
}

function initMobileSidebar() {
  if (!sidebarToggleEl || !sidebarPanelEl || !sidebarBackdropEl) return;

  const applyByWidth = () => {
    if (!isMobileSidebar()) {
      sidebarPanelEl.classList.remove("is-open");
      sidebarBackdropEl.hidden = true;
      sidebarToggleEl.setAttribute("aria-expanded", "false");
      sidebarToggleEl.setAttribute("aria-label", "Open controls");
      return;
    }
    setSidebarOpen(false);
  };

  applyByWidth();
  window.addEventListener("resize", applyByWidth);

  sidebarToggleEl.addEventListener("click", () => {
    if (!isMobileSidebar()) return;
    const next = !sidebarPanelEl.classList.contains("is-open");
    setSidebarOpen(next);
  });

  sidebarBackdropEl.addEventListener("click", () => setSidebarOpen(false));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setSidebarOpen(false);
  });
}

initMobileSidebar();

renderSidebarBankChoices();
resetCardForm();
initClerk().catch((err) => {
  console.error(err);
  if (authStatusEl) {
    authStatusEl.textContent = "Could not initialize Clerk.";
  }
});
