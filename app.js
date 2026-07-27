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
const giftCardOnly = document.getElementById("giftCardOnly");
const acceptingOnly = document.getElementById("acceptingOnly");
const resultsEl = document.getElementById("results");
const statEl = document.getElementById("stat");

let allFeatures = [];
let popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "300px",
  offset: 14,
});

function typeLabel(key) {
  return TYPE_LABELS[key] || key.replaceAll("_", " ");
}

function matchesFilters(props, query) {
  if (giftCardOnly.checked && !props.giftCard) return false;
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
      return `<li tabindex="0" data-index="${i}">
        <span class="name">${escapeHtml(p.name)}</span>
        <span class="meta">${escapeHtml([p.city, p.state].filter(Boolean).join(", "))} Ã‚Â· ${escapeHtml(typeLabel(p.businessType))}</span>
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

function showPopup(feature) {
  const p = feature.properties;
  const [lng, lat] = feature.geometry.coordinates;
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
    ? `<a href="${escapeHtml(p.orderingUrl)}" target="_blank" rel="noopener noreferrer">Open Clover ordering Ã¢â€ â€™</a>`
    : "";

  popup
    .setLngLat([lng, lat])
    .setHTML(
      `<div class="popup">
        <h2>${escapeHtml(p.name)}</h2>
        ${badges.join("")}
        <p>${escapeHtml(p.address || [p.city, p.state].filter(Boolean).join(", "))}</p>
        ${statusNote}
        ${link}
      </div>`
    )
    .addTo(map);
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
giftCardOnly.addEventListener("change", applyFilters);
acceptingOnly.addEventListener("change", applyFilters);

document.getElementById("reset").addEventListener("click", () => {
  searchInput.value = "";
  typeSelect.value = "";
  giftCardOnly.checked = false;
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

map.on("load", async () => {
  addMerchantLayers();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    statEl.textContent = "Could not load merchant data.";
  }
});
