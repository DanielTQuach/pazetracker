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