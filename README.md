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