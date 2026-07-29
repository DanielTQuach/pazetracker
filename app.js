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
const authStatusEl = document.getElementById("authStatus");
const authActionsEl = document.getElementById("authActions");
const userSummaryEl = document.getElementById("userSummary");
const userSummaryTextEl = document.getElementById("userSummaryText");
const cardManagerEl = document.getElementById("cardManager");
const cardsListEl = document.getElementById("cardsList");
const cardsEmptyEl = document.getElementById("cardsEmpty");
const sidebarBankGridEl = document.getElementById("sidebarBankGrid");
const sidebarCardLabelEl = document.getElementById("sidebarCardLabel");
const sidebarCardRemainingEl = document.getElementById("sidebarCardRemaining");

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
const PENDING_ORDER_STORAGE_KEY = "pazetracker_pending_order_v1";
const USER_CARDS_STORAGE_KEY = "pazetracker_user_cards_v1";

const BANKS = [
  { id: "boa", name: "Bank of America", short: "BofA" },
  { id: "capital_one", name: "Capital One", short: "Cap1" },
  { id: "chase", name: "Chase", short: "Chase" },
  { id: "citi", name: "Citi", short: "Citi" },
  { id: "pnc", name: "PNC", short: "PNC" },
  { id: "truist", name: "Truist", short: "Truist" },
  { id: "us_bank", name: "U.S. Bank", short: "US Bank" },
  { id: "wells_fargo", name: "Wells Fargo", short: "Wells" },
  { id: "elan_financial", name: "Elan Financial Services", short: "Elan" },
  { id: "star_one_credit_union", name: "Star One Credit Union", short: "Star One" },
];

let orderModal = null;
let orderStep1El = null;
let orderStep2El = null;
let orderStep3El = null;
let orderBankGridEl = null;
let orderCardLabelEl = null;
let orderRemainingEl = null;
let currentPendingOrder = null;
let orderModalOpen = false;
let selectedBankId = "";
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

// Prevent crowd-report spam: only allow 1 community update per place per day (per browser).
const USER_ORDER_REPORTS_STORAGE_KEY = "pazetracker_user_order_reports_v1";

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

function markOrderReportSubmittedToday(placeId) {
  if (!placeId) return;
  const map = getOrderReportsMap();
  map[String(placeId)] = todayLocalKey();
  localStorage.setItem(USER_ORDER_REPORTS_STORAGE_KEY, JSON.stringify(map));
}

function hasSubmittedOrderReportToday(placeId) {
  if (!placeId) return false;
  const map = getOrderReportsMap();
  return map[String(placeId)] === todayLocalKey();
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
    authStatusEl.textContent = "Sign-in is not configured yet. Cards stay local until Clerk is set up.";
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

  if (!authState.config?.clerk?.enabled) return;

  if (!signedIn) {
    authStatusEl.textContent = "Sign in to sync your tracker cards across devices.";
    userSummaryTextEl.textContent = "";
    return;
  }

  authStatusEl.textContent = "";
  const displayName =
    authState.user.firstName ||
    authState.user.username ||
    authState.user.primaryEmailAddress?.emailAddress ||
    "Signed in";
  userSummaryTextEl.textContent = displayName;
}

async function loadSyncedCards() {
  const res = await authedFetch("/api/user-cards");
  if (!res.ok) throw new Error("Failed to load synced cards");
  const data = await res.json();
  syncedCards = Array.isArray(data.cards) ? data.cards : [];
  renderSyncedCards();
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
  renderSyncedCards();
}

function resetCardForm() {
  selectedSyncedCardId = null;
  selectedSidebarBankId = BANKS[0]?.id || "";
  if (sidebarCardLabelEl) sidebarCardLabelEl.value = "";
  if (sidebarCardRemainingEl) sidebarCardRemainingEl.value = "10";
  renderSidebarBankChoices();
  renderSyncedCards();
}

function findCard(cards, bankId, label) {
  const normalized = String(label || "").trim();
  if (!normalized) return null;
  return cards.find((c) => c.bankId === bankId && c.label === normalized) || null;
}

function getRemainingPlays(bankId, label) {
  const cards = getUserCards();
  const card = findCard(cards, bankId, label);
  const used = card?.usedCount || 0;
  return Math.max(0, ORDER_PLAY_LIMIT_PER_CARD - used);
}

function setStep(stepNumber) {
  if (!orderStep1El || !orderStep2El || !orderStep3El) return;
  orderStep1El.hidden = stepNumber !== 1;
  orderStep2El.hidden = stepNumber !== 2;
  orderStep3El.hidden = stepNumber !== 3;
}

function renderBankChoices() {
  if (!orderBankGridEl) return;
  orderBankGridEl.innerHTML = "";

  for (const bank of BANKS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "order-bank-choice";
    btn.dataset.bankId = bank.id;
    btn.setAttribute("aria-label", bank.name);
    btn.innerHTML = `
      <div class="order-bank-simulated-card">${escapeHtml(bank.short)}</div>
      <div class="order-bank-name">${escapeHtml(bank.name)}</div>
    `;
    if (bank.id === selectedBankId) btn.classList.add("is-selected");
    btn.addEventListener("click", () => {
      selectedBankId = bank.id;
      renderBankChoices();
      updateRemaining();
    });
    orderBankGridEl.appendChild(btn);
  }
}

function renderSidebarBankChoices() {
  if (!sidebarBankGridEl) return;
  sidebarBankGridEl.innerHTML = "";

  for (const bank of BANKS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "order-bank-choice";
    btn.dataset.bankId = bank.id;
    btn.setAttribute("aria-label", bank.name);
    btn.innerHTML = `
      <div class="order-bank-simulated-card">${escapeHtml(bank.short)}</div>
      <div class="order-bank-name">${escapeHtml(bank.name)}</div>
    `;
    if (bank.id === selectedSidebarBankId) btn.classList.add("is-selected");
    btn.addEventListener("click", () => {
      selectedSidebarBankId = bank.id;
      renderSidebarBankChoices();
    });
    sidebarBankGridEl.appendChild(btn);
  }
}

function updateRemaining() {
  const label = (orderCardLabelEl?.value || "").trim();
  if (!selectedBankId || !label) {
    if (orderRemainingEl) orderRemainingEl.textContent = "Remaining: -";
    return;
  }
  const remaining = getRemainingPlays(selectedBankId, label);
  if (orderRemainingEl) orderRemainingEl.textContent = `Remaining: ${remaining}/${ORDER_PLAY_LIMIT_PER_CARD}`;
}

function getBankById(bankId) {
  return BANKS.find((b) => b.id === bankId) || BANKS[0];
}

function renderSyncedCards() {
  if (!cardsListEl || !cardsEmptyEl) return;
  cardsListEl.innerHTML = "";
  cardsEmptyEl.hidden = syncedCards.length > 0;

  for (const card of syncedCards) {
    const bank = getBankById(card.bankId);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "saved-card";
    if (card.id === selectedSyncedCardId) btn.classList.add("is-selected");
    btn.innerHTML = `
      <div class="saved-card-top">
        <div class="order-bank-simulated-card">${escapeHtml(bank.short)}</div>
        <div class="saved-card-copy">
          <span class="saved-card-label">${escapeHtml(card.label)}</span>
          <span class="saved-card-bank">${escapeHtml(bank.name)}</span>
          <span class="saved-card-remaining">${clampRemaining(card.remainingCount)}/10 promos left</span>
        </div>
      </div>
    `;
    btn.addEventListener("click", () => {
      selectedSyncedCardId = card.id;
      selectedSidebarBankId = card.bankId;
      if (sidebarCardLabelEl) sidebarCardLabelEl.value = card.label;
      if (sidebarCardRemainingEl) sidebarCardRemainingEl.value = String(clampRemaining(card.remainingCount));
      renderSidebarBankChoices();
      renderSyncedCards();
    });
    cardsListEl.appendChild(btn);
  }
}

async function submitOrderReport({ placeId, orderingUrl, success, bankId, cardLabel }) {
  if (!placeId) return;
  const payload = {
    placeId,
    orderingUrl: orderingUrl || "",
    success: !!success,
    cardInstitution: bankId || null,
    cardLabel: cardLabel || null,
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
  sessionStorage.setItem("pazetracker_order_modal_open_v1", "1");

  if (orderModal) {
    orderModal.hidden = false;
    orderModal.setAttribute("aria-hidden", "false");
  }

  selectedBankId = BANKS[0]?.id || "";
  orderCardLabelEl.value = "";
  updateRemaining();
  renderBankChoices();
  setStep(1);
}

function closeOrderModal({ keepPending = false } = {}) {
  if (orderModal) {
    orderModal.hidden = true;
    orderModal.setAttribute("aria-hidden", "true");
  }
  orderModalOpen = false;
  sessionStorage.removeItem("pazetracker_order_modal_open_v1");
  if (!keepPending) sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
  currentPendingOrder = null;
}

function wireOrderModalUi() {
  orderModal = document.getElementById("orderModal");
  orderStep1El = document.getElementById("orderStep1");
  orderStep2El = document.getElementById("orderStep2");
  orderStep3El = document.getElementById("orderStep3");
  orderBankGridEl = document.getElementById("orderBankGrid");
  orderCardLabelEl = document.getElementById("orderCardLabel");
  orderRemainingEl = document.getElementById("orderRemaining");

  if (!orderModal || !orderStep1El || !orderCardLabelEl) return;

  document.getElementById("orderModalClose")?.addEventListener("click", () => closeOrderModal());
  document.getElementById("orderYesBtn")?.addEventListener("click", () => setStep(2));
  document.getElementById("orderNoBtn")?.addEventListener("click", async () => {
    const p = currentPendingOrder;
    if (!p?.placeId) return;
    try {
      if (!hasSubmittedOrderReportToday(p.placeId)) {
        await submitOrderReport({
          placeId: p.placeId,
          orderingUrl: p.orderingUrl,
          success: false,
        });
        markOrderReportSubmittedToday(p.placeId);
      }
    } finally {
      closeOrderModal();
    }
  });
  document.getElementById("orderSubmitBtn")?.addEventListener("click", async () => {
    const p = currentPendingOrder;
    if (!p?.placeId) return;
    const label = (orderCardLabelEl.value || "").trim();
    if (!selectedBankId || !label) {
      alert("Please enter a card label.");
      return;
    }

    // Update user-local remaining counter (no payment details stored).
    const cards = getUserCards();
    let card = findCard(cards, selectedBankId, label);
    if (!card) {
      card = { bankId: selectedBankId, label, usedCount: 0 };
      cards.push(card);
    }
    card.usedCount = (card.usedCount || 0) + 1;
    setUserCards(cards);
    updateRemaining();

    try {
      if (!hasSubmittedOrderReportToday(p.placeId)) {
        await submitOrderReport({
          placeId: p.placeId,
          orderingUrl: p.orderingUrl,
          success: true,
          bankId: selectedBankId,
          cardLabel: label,
        });
        markOrderReportSubmittedToday(p.placeId);
      }
    } catch (e) {
      alert(String(e?.message || e));
      return;
    }

    setStep(3);
  });
  document.getElementById("orderDoneBtn")?.addEventListener("click", () => closeOrderModal());

  orderCardLabelEl.addEventListener("input", () => updateRemaining());
}

function safeDomId(placeId) {
  return `community_${placeId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function refreshCommunityStats(placeId) {
  if (!placeId) return;
  const popupEl = popup.getElement();
  if (!popupEl) return;

  const domId = safeDomId(placeId);
  const el = popupEl.querySelector(`#${domId}`);
  if (!el) return;

  el.textContent = "Community: loading...";
  const res = await fetch(`/api/order-report-stats?placeId=${encodeURIComponent(placeId)}`);
  if (!res.ok) return;
  const stats = await res.json();

  if (!stats?.total) {
    el.textContent = "Community: no reports yet";
    return;
  }

  const pct = Math.round((stats.yes / stats.total) * 100);
  el.textContent = `Community: ${pct}% success (${stats.yes} yes / ${stats.no} no)`;
}

function wireOrderingLinkHandler(p) {
  const popupEl = popup.getElement();
  const link = popupEl?.querySelector(".ordering-link");
  if (!link) return;
  link.addEventListener("click", () => {
    if (!p?.id || !p?.orderingUrl) return;
    sessionStorage.setItem(
      PENDING_ORDER_STORAGE_KEY,
      JSON.stringify({ placeId: p.id, orderingUrl: p.orderingUrl, at: Date.now() })
    );
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
    ? `<p class="popup-community" id="${communityDomId}">Community: -</p>`
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

function showPopup(feature) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;

  popup
    .setLngLat([lng, lat])
    .setHTML(buildPopupInnerHtml(p, "loading"))
    .addTo(map);

  const popupEl = popup.getElement();
  if (popupEl) wirePopupGallery(popupEl);
  if (popupEl) wireOrderingLinkHandler(p);
  refreshCommunityStats(p.id);

  loadPlaceImages(feature)
    .then((data) => {
      if (!popup.isOpen()) return;
      popup.setHTML(buildPopupInnerHtml(p, data));
      const el = popup.getElement();
      if (el) wirePopupGallery(el);
      if (el) wireOrderingLinkHandler(p);
      refreshCommunityStats(p.id);
    })
    .catch(() => {
      if (!popup.isOpen()) return;
      popup.setHTML(buildPopupInnerHtml(p, "error"));
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

document.getElementById("locate").addEventListener("click", () => {
  if (!navigator.geolocation) {
    alert("Geolocation is not available in this browser.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      map.flyTo({
        center: [pos.coords.longitude, pos.coords.latitude],
        zoom: 11.5,
        speed: 1.4,
      });
    },
    () => alert("Could not get your location."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
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

map.on("load", async () => {
  addMerchantLayers();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    statEl.textContent = "Could not load merchant data.";
  }
});

wireOrderModalUi();

function checkPendingOrder() {
  if (orderModalOpen) return;
  if (sessionStorage.getItem("pazetracker_order_modal_open_v1") === "1") return;
  const raw = sessionStorage.getItem(PENDING_ORDER_STORAGE_KEY);
  if (!raw) return;

  // Avoid "stuck" modal if pending state is stale (e.g. page refresh).
  try {
    const pending = JSON.parse(raw);
    if (pending?.at && Date.now() - pending.at > 10 * 60 * 1000) {
      sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
      return;
    }
  } catch {
    sessionStorage.removeItem(PENDING_ORDER_STORAGE_KEY);
    return;
  }

  openOrderModalFromPending();
}

let hasBeenHiddenSinceLoad = false;
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") hasBeenHiddenSinceLoad = true;
  if (document.visibilityState === "visible" && hasBeenHiddenSinceLoad) {
    hasBeenHiddenSinceLoad = false;
    checkPendingOrder();
  }
});

let hasLostFocusSinceLoad = false;
window.addEventListener("blur", () => {
  hasLostFocusSinceLoad = true;
});
window.addEventListener("focus", () => {
  if (!hasLostFocusSinceLoad) return;
  hasLostFocusSinceLoad = false;
  checkPendingOrder();
});

renderSidebarBankChoices();
resetCardForm();
initClerk().catch((err) => {
  console.error(err);
  if (authStatusEl) {
    authStatusEl.textContent = "Could not initialize Clerk.";
  }
});
