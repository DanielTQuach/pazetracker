# Creates 14 atomic commits on main. Run once from a clean working tree (uncommitted app files).
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root

$FinalApp = Get-Content (Join-Path $Root "app.js") -Raw
$FinalStyles = Get-Content (Join-Path $Root "styles.css") -Raw
$FinalPackage = Get-Content (Join-Path $Root "package.json") -Raw
$FinalReadme = @'
# pazetracker

MapLibre GL JS map of ~28k US Clover merchants (restaurants, cafes, retail, etc.) that expose online checkout - useful for finding places where Paze can appear at Clover checkout.

## Quick start

```bash
npm start
```

Open [http://localhost:5173](http://localhost:5173).

## Data

Local snapshot lives in `data/clover-merchants.geojson` (~26.5k restaurants + ~1.5k other businesses). The file is generated locally and not committed.

Refresh from the public nextcard discovery snapshot:

```bash
npm run fetch-data
```

## Notes

- Basemap: [OpenFreeMap](https://openfreemap.org/) (no API key)
- Points are clustered; click a pin for address + Clover ordering link
- Filters: search, business type, gift cards, accepting online orders
'@

function Commit-Step($Message, $Paths) {
  foreach ($p in $Paths) {
    git add -f -- $p
  }
  if (-not (git diff --cached --quiet)) {
    git commit -m $Message
    Write-Host "OK: $Message"
  } else {
    throw "Empty commit: $Message (paths: $($Paths -join ', '))"
  }
}

function Set-ContentUtf8($Path, $Content) {
  $full = if ($Path -match '^[A-Za-z]:') { $Path } else { Join-Path $Root $Path }
  $dir = Split-Path $full -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  [System.IO.File]::WriteAllText($full, $Content.TrimStart("`n"), [System.Text.UTF8Encoding]::new($false))
}

# 1
Set-ContentUtf8 ".gitignore" @'
node_modules/
.DS_Store
*.log
.cache/
'@
Commit-Step "chore: add gitignore for local dev artifacts" ".gitignore"

# 2
Set-ContentUtf8 "package.json" @'
{
  "name": "pazetracker",
  "version": "1.0.0",
  "private": true,
  "description": "MapLibre map of US Clover merchants (Paze checkout)",
  "scripts": {
    "start": "npx --yes serve -l 5173 ."
  }
}
'@
Commit-Step "chore: add static dev server script" "package.json"

# 3
Set-ContentUtf8 "README.md" @'
# pazetracker

Clover merchant map (work in progress). Run `npm start` and open http://localhost:5173.
'@
Commit-Step "docs: add minimal readme with dev server instructions" "README.md"

# 4
Commit-Step "feat: add script to fetch Clover merchant snapshot" "scripts/fetch-data.mjs"

# 5
Commit-Step "data: add merchant snapshot metadata" "data/meta.json"

# 6
Set-ContentUtf8 ".gitignore" @'
node_modules/
.DS_Store
*.log
.cache/
data/clover-merchants.geojson
'@
Commit-Step "chore: ignore generated merchant GeoJSON" ".gitignore"

# 7
Set-ContentUtf8 "index.html" @'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PazeTracker — Clover merchants map</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"
    />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="app">
      <aside class="panel" aria-label="Sidebar">
        <header class="panel-header">
          <p class="brand">PazeTracker</p>
          <h1>Clover merchants</h1>
          <p class="subtitle">
            US restaurants, cafes &amp; businesses with Clover online checkout
          </p>
        </header>
        <footer class="panel-footer">
          <p>Data from public Clover online-ordering listings.</p>
        </footer>
      </aside>
      <main id="map" role="application" aria-label="Merchant map"></main>
    </div>
    <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
    <script src="app.js" type="module"></script>
  </body>
</html>
'@
Commit-Step "feat: add html shell with map container and sidebar" "index.html"

# 8
Set-ContentUtf8 "styles.css" @'
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap");

:root {
  --bg: #f3efe6;
  --panel: #faf7f0;
  --ink: #1c1914;
  --muted: #5f574c;
  --line: #d9d0c0;
  --accent: #0f6b5c;
  --font-display: "Fraunces", "Iowan Old Style", Georgia, serif;
  --font-body: "Source Sans 3", "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  color: var(--ink);
  background: var(--bg);
  font-family: var(--font-body);
}

#app {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  height: 100%;
}

.panel {
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.25rem 1.2rem 1rem;
  background:
    radial-gradient(ellipse at 0% 0%, rgba(196, 92, 38, 0.08), transparent 50%),
    linear-gradient(180deg, #fffaf2 0%, var(--panel) 100%);
  border-right: 1px solid var(--line);
  overflow: auto;
}

.panel-header h1 {
  margin: 0.15rem 0 0.35rem;
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.brand {
  margin: 0;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.subtitle {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.4;
}

.panel-footer {
  margin-top: auto;
  padding-top: 0.5rem;
}

.panel-footer p {
  margin: 0;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

#map {
  min-height: 100%;
}

@media (max-width: 860px) {
  #app {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .panel {
    border-right: none;
    border-bottom: 1px solid var(--line);
    max-height: 46vh;
  }

  #map {
    min-height: 54vh;
  }
}
'@
Commit-Step "feat: add base layout and panel styles" "styles.css"

# 9
Set-ContentUtf8 "app.js" @'
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-98.35, 39.5],
  zoom: 3.6,
  attributionControl: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), "bottom-right");
'@
Commit-Step "feat: initialize MapLibre map with basemap and controls" "app.js"

# 10
Set-ContentUtf8 "app.js" @'
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: [-98.35, 39.5],
  zoom: 3.6,
  attributionControl: true,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120 }), "bottom-right");

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
  const geoRes = await fetch("./data/clover-merchants.geojson");
  if (!geoRes.ok) throw new Error("Failed to load merchant GeoJSON");
  const geojson = await geoRes.json();
  map.getSource("merchants").setData(geojson);
}

map.on("load", async () => {
  addMerchantLayers();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
  }
});
'@
Commit-Step "feat: load merchants GeoJSON with clustered map layers" "app.js"

# 11 — popups + popup styles (partial styles without filter UI)
Set-ContentUtf8 "app.js" @'
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

let popup = new maplibregl.Popup({
  closeButton: true,
  closeOnClick: true,
  maxWidth: "300px",
  offset: 14,
});

function typeLabel(key) {
  return TYPE_LABELS[key] || key.replaceAll("_", " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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
    ? `<a href="${escapeHtml(p.orderingUrl)}" target="_blank" rel="noopener noreferrer">Open Clover ordering →</a>`
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
    showPopup(e.features[0]);
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
  const geoRes = await fetch("./data/clover-merchants.geojson");
  if (!geoRes.ok) throw new Error("Failed to load merchant GeoJSON");
  const geojson = await geoRes.json();
  map.getSource("merchants").setData(geojson);
}

map.on("load", async () => {
  addMerchantLayers();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
  }
});
'@

Set-ContentUtf8 "styles.css" @'
@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,700&family=Source+Sans+3:wght@400;600;700&display=swap");

:root {
  --bg: #f3efe6;
  --panel: #faf7f0;
  --ink: #1c1914;
  --muted: #5f574c;
  --line: #d9d0c0;
  --accent: #0f6b5c;
  --warm: #c45c26;
  --shadow: 0 12px 40px rgba(28, 25, 20, 0.12);
  --font-display: "Fraunces", "Iowan Old Style", Georgia, serif;
  --font-body: "Source Sans 3", "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  height: 100%;
  color: var(--ink);
  background: var(--bg);
  font-family: var(--font-body);
}

#app {
  display: grid;
  grid-template-columns: minmax(280px, 360px) 1fr;
  height: 100%;
}

.panel {
  z-index: 2;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 1.25rem 1.2rem 1rem;
  background:
    radial-gradient(ellipse at 0% 0%, rgba(196, 92, 38, 0.08), transparent 50%),
    linear-gradient(180deg, #fffaf2 0%, var(--panel) 100%);
  border-right: 1px solid var(--line);
  overflow: auto;
}

.panel-header h1 {
  margin: 0.15rem 0 0.35rem;
  font-family: var(--font-display);
  font-size: 1.7rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
}

.brand {
  margin: 0;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.subtitle {
  margin: 0;
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.4;
}

.panel-footer {
  margin-top: auto;
  padding-top: 0.5rem;
}

.panel-footer p {
  margin: 0;
  color: var(--muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

#map {
  min-height: 100%;
}

.maplibregl-popup-content {
  padding: 0;
  border-radius: 12px;
  box-shadow: var(--shadow);
  overflow: hidden;
  font-family: var(--font-body);
}

.maplibregl-popup-close-button {
  font-size: 1.2rem;
  color: var(--muted);
}

.popup {
  min-width: 220px;
  max-width: 280px;
  padding: 0.9rem 1rem 1rem;
}

.popup h2 {
  margin: 0 0 0.35rem;
  font-family: var(--font-display);
  font-size: 1.15rem;
  line-height: 1.2;
}

.popup p {
  margin: 0 0 0.45rem;
  color: var(--muted);
  font-size: 0.88rem;
  line-height: 1.35;
}

.popup .badge {
  display: inline-block;
  margin: 0 0.35rem 0.55rem 0;
  padding: 0.15rem 0.45rem;
  border-radius: 999px;
  background: #e8f3ef;
  color: var(--accent);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.popup .badge.warn {
  background: #f7ebe3;
  color: var(--warm);
}

.popup a {
  display: inline-flex;
  margin-top: 0.25rem;
  color: var(--accent);
  font-weight: 700;
  text-decoration: none;
}

.popup a:hover {
  text-decoration: underline;
}

@media (max-width: 860px) {
  #app {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
  }

  .panel {
    border-right: none;
    border-bottom: 1px solid var(--line);
    max-height: 46vh;
  }

  #map {
    min-height: 54vh;
  }
}
'@
Commit-Step "feat: show merchant details in map popups" "app.js" "styles.css"

# 12
Set-ContentUtf8 "index.html" @'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PazeTracker — Clover merchants map</title>
    <link
      rel="stylesheet"
      href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"
    />
    <link rel="stylesheet" href="styles.css" />
  </head>
  <body>
    <div id="app">
      <aside class="panel" aria-label="Filters">
        <header class="panel-header">
          <p class="brand">PazeTracker</p>
          <h1>Clover merchants</h1>
          <p class="subtitle">
            US restaurants, cafes &amp; businesses with Clover online checkout
          </p>
        </header>

        <div class="stat" id="stat">Loading…</div>

        <label class="field">
          <span>Search</span>
          <input
            id="search"
            type="search"
            placeholder="Name, city, or address"
            autocomplete="off"
          />
        </label>

        <label class="field">
          <span>Business type</span>
          <select id="businessType">
            <option value="">All types</option>
          </select>
        </label>

        <label class="check">
          <input type="checkbox" id="giftCardOnly" />
          <span>Gift card checkout only</span>
        </label>

        <label class="check">
          <input type="checkbox" id="acceptingOnly" />
          <span>Accepting online orders</span>
        </label>

        <div class="actions">
          <button type="button" id="locate" class="btn">Near me</button>
          <button type="button" id="reset" class="btn btn-ghost">Reset</button>
        </div>

        <ul id="results" class="results" hidden></ul>

        <footer class="panel-footer">
          <p>
            Data aggregated from public Clover online-ordering listings.
            Eligibility and order status can change.
          </p>
        </footer>
      </aside>

      <main id="map" role="application" aria-label="Merchant map"></main>
    </div>

    <script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
    <script src="app.js" type="module"></script>
  </body>
</html>
'@

Set-ContentUtf8 "styles.css" $FinalStyles
Commit-Step "feat: add sidebar filter controls and result list markup" "index.html" "styles.css"

# 13
Set-ContentUtf8 "app.js" $FinalApp
Commit-Step "feat: wire search, filters, and geolocation controls" "app.js"

# 14
Set-ContentUtf8 "package.json" $FinalPackage
Set-ContentUtf8 "README.md" $FinalReadme
Commit-Step "docs: document data refresh and map usage" "package.json" "README.md"

Write-Host "Done. $(git rev-list --count HEAD) commits on main."
