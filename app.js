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
    ? `<a href="${escapeHtml(p.orderingUrl)}" target="_blank" rel="noopener noreferrer">Open Clover ordering â†’</a>`
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