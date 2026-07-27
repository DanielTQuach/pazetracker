/**
 * Downloads the latest nextcard restaurant discovery snapshot and writes
 * local Clover (clover-paze) merchant GeoJSON under data/.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CURRENT_URL =
  "https://nextcard-static.s3.us-east-1.amazonaws.com/discovery-map-tiles/restaurants/current.json";

async function main() {
  console.log("Fetching current snapshot pointer…");
  const current = await (await fetch(CURRENT_URL)).json();
  const manifest = await (await fetch(current.manifestUrl)).json();
  const snapshotUrl = manifest.artifactUrls?.snapshot;
  if (!snapshotUrl) throw new Error("No snapshot URL in manifest");

  console.log(`Downloading snapshot (${manifest.placeCount} places)…`);
  const snapshot = await (await fetch(snapshotUrl)).json();
  const clover = (snapshot.places || []).filter(
    (p) => Array.isArray(p.sources) && p.sources.includes("clover-paze")
  );

  const byType = {};
  let giftCards = 0;
  for (const p of clover) {
    byType[p.businessType] = (byType[p.businessType] || 0) + 1;
    if (p.giftCard) giftCards += 1;
  }

  const geo = {
    type: "FeatureCollection",
    features: clover.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        name: p.name,
        city: p.city || "",
        state: p.state || "",
        address: p.streetAddress || "",
        businessType: p.businessType || "restaurants",
        giftCard: !!p.giftCard,
        orderingUrl:
          p.extra?.orderingUrl ||
          p.extra?.profileUrl ||
          p.extra?.sourceRestaurantUrls?.["clover-paze"] ||
          "",
        orderingStatus: p.extra?.orderingStatus || "",
        orderingStatusMessage: p.extra?.orderingStatusMessage || "",
      },
    })),
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const geoPath = path.join(DATA_DIR, "clover-merchants.geojson");
  fs.writeFileSync(geoPath, JSON.stringify(geo));

  const meta = {
    count: clover.length,
    byType,
    giftCards,
    generatedAt: new Date().toISOString(),
    snapshotId: snapshot.snapshotId || current.snapshotId,
    source:
      "nextcard discovery-map restaurants snapshot (filtered to clover-paze)",
  };
  fs.writeFileSync(path.join(DATA_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(`Wrote ${clover.length.toLocaleString()} merchants → ${geoPath}`);
  console.log(meta.byType);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
