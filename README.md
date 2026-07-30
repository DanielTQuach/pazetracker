# pazetracker

MapLibre GL JS map of ~28k US Clover merchants (restaurants, cafes, retail, etc.) that expose online checkout - useful for finding places where Paze can appear at Clover checkout.

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

Open [http://localhost:5173](http://localhost:5173).

## Environment

### Google Places

Used for popup photos, search result thumbnails, and ratings.

- `GOOGLE_MAPS_API_KEY`
- Enable **Places API (New)**

**Railway / server:** this app calls Places from Node (no browser referrer). In Google Cloud → API key → Application restrictions, use **None** (or IP addresses — not HTTP referrers). API restrictions: **Places API (New)** only. Referrer-locked keys fail with `API_KEY_HTTP_REFERRER_BLOCKED`.

### Clerk

Used for **optional sign-in** and **synced card tracking across devices**.

- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `APP_ORIGIN=http://localhost:5173`

Optional overrides (normally derived / unused when secret key is set):

- `CLERK_FRONTEND_API`
- `CLERK_JWT_KEY`

Pull keys with the Clerk CLI after `clerk auth login` and `clerk link`:

```bash
clerk env pull --file .env
```

The card tracker is manual only:

- users choose from the supported bank list
- users type a card label like `Chase debit`
- users set remaining promos from `0` to `10`
- no bank connection, no payment details, no real card numbers

## Synced cards

When signed in, users can:

- add named tracker cards
- choose a bank and see a wallet-style virtual card tile
- set how many promos remain (`0-10`)
- come back on another device and see the same saved cards

If Clerk is not configured, the auth section stays disabled gracefully.

## Community tracker

Everyone can see a public **community promos redeemed** count. It increases when someone reports a successful Clover order after opening ordering from the map. This is crowdsourced and in good faith.

## Postgres (Railway)

Without `DATABASE_URL`, synced cards, order reports, and community stats use local JSON/ndjson under `data/`. For production (e.g. Railway Postgres), set:

- `DATABASE_URL` — connection string from Railway
- `DATABASE_SSL=false` — only if your local Postgres has no SSL (remote Railway URLs use SSL by default)

Apply the schema once:

```bash
npm run db:migrate
```

Schema lives in `db/schema.sql`. The server picks Postgres automatically when `DATABASE_URL` is set (`/api/config` reports `dataStore: "postgres"`).

## Redis rate limits (Railway)

Used only for short-lived anti-abuse counters on crowd write endpoints (`POST /api/order-report`, `POST /api/promo-redeem`). Durable data stays in Postgres.

Without `REDIS_URL`, limits use in-memory counters (fine locally / single instance).

1. Project canvas → **+ New** → **Database** → **Redis**
2. On the app service **Variables**, add `REDIS_URL` referencing the Redis service (e.g. `${{Redis.REDIS_URL}}`)
3. Redeploy — no migrate step

`/api/config` reports `rateLimit: "redis"` or `"memory"`.

Order reports: up to **3 per restaurant per IP per UTC day**, and **30 total per IP per 24h** (abuse guard). Card promo logging can still work after that cap via a separate endpoint, but extra crowd report rows stop.

## Data

Local snapshot lives in `data/clover-merchants.geojson` (~26.5k restaurants + ~1.5k other businesses). The file is generated locally and not committed.

Refresh from the public nextcard discovery snapshot:

```bash
npm run fetch-data
```

## Notes

- Basemap: [OpenFreeMap](https://openfreemap.org/) (no API key)
- Points are clustered; click a pin for Google photo gallery, address, and Clover ordering link
- Search results can show Google thumbnails + ratings
- Crowd order reports are stored separately from synced user cards
- A public community promos redeemed counter updates on successful order reports
