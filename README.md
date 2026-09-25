# BayWheel(.ing)

[![Next.js](https://img.shields.io/badge/Next.js-black?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![MapLibre GL](https://img.shields.io/badge/MapLibre_GL-FF0000?logo=openstreetmap&logoColor=white)](https://maplibre.org)
[![Deck.gl](https://img.shields.io/badge/Deck.gl-blue)](https://deck.gl)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white)](https://cloudflare.com)
[![wakatime](https://wakatime.com/badge/user/33a2bb04-aa22-4536-80a6-3014c35843e1/project/8b262d6f-f59b-45bd-84ca-71421e8c98f5.svg)](https://wakatime.com/badge/user/33a2bb04-aa22-4536-80a6-3014c35843e1/project/8b262d6f-f59b-45bd-84ca-71421e8c98f5)

Exploring Bay Area bike-share patterns with Bay Wheel open data

## About

Baywheel.ing visualizes BayWheels trip patterns using [anonymized historical system data published by Lyft](https://www.lyft.com/bikes/bay-wheels/system-data).

## How It Works

Click any station to view stats. Browse different months to spot seasonal patterns.

## Architecture

### Database & Caching

**Rides Data:**
- New archives are reduced to station/month summaries and origin→destination counts in **KV**; the app does not need individual ride rows to draw the map or show its stats
- Existing monthly `rides_YYYYMM` tables in **D1** remain available as a source for rebuilding summaries during the migration

**Route Polylines:**
- Cycling paths are fetched from the **OSRM API** as needed and cached once per station pair in **KV**
- Monthly ride counts are grouped by origin→destination pair, and busy lines are drawn thicker

**Station Stats:**
- Station/month totals, average and longest ride duration, breakdowns, and route counts are precomputed in **KV**, so selecting a station reads a compact summary instead of loading every ride

### Rate Limiting

OSRM enforces a **1 request/second** limit per IP. To respect this:
- Client initiates requests with a **2 concurrent** limit
- Requests are **staggered by 500ms** (queueIndex * 500) to maintain spacing
- Combined with Cloudflare's caching, this prevents bandwidth blocks

## Limitations

**Route lines** are computed using [OSRM](https://project-osrm.org), the only free open-source routing engine I could find.

It only supports `driving` and `walking` modes. `Cycling` is used here.

If you have another free and simple option, feel free to open an issue.

## Built With

- [Next.js](https://nextjs.org) with [shadcn/ui](https://ui.shadcn.com) and [Tailwind](https://tailwindcss.com)
- [MapLibre GL](https://maplibre.org) (via [mapcn](https://developers.maptiler.com/docs/mapcn) and [carto](https://carto.com)) for mapping
- [Deck.gl](https://deck.gl) for route rendering
- [Dither Kit](https://tripwire.sh/dither-kit) for dithered charts and visual primitives
- **[Cloudflare Workers](https://workers.cloudflare.com)** — Edge compute for OSRM routing requests and API proxying
- **[Cloudflare D1](https://developers.cloudflare.com/d1)** — SQLite database for caching computed route polylines, reducing API calls to OSRM
- **[Cloudflare KV](https://developers.cloudflare.com/kv)** — Key-value store for rapid access to station metadata and frequently-requested aggregated trip statistics
- [Cloudflare](https://cloudflare.com) via [opennext](https://opennext.js.org) for hosting

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm
- Cloudflare account with D1 and KV enabled

### Setup

1. **Clone and install:**
   ```bash
   git clone https://github.com/samwarnick/baywheeling
   cd baywheeling
   pnpm install
   pnpm run init
   ```

2. **Run the development server:**
   ```bash
   pnpm dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

3. **Deploying to Cloudflare (optional):**
   ```bash
   pnpm deploy
   ```
   This builds and deploys to Cloudflare Pages, Workers, D1, and KV using the bindings configured in `wrangler.jsonc`.

## Data Ingestion

> [!NOTE]  
> The app relies on historical trip data from Lyft's Bay Wheels system. This data is not included in the repository due to size, but you can easily load it yourself using the steps below. 
> Make you run the `init` script before loading data, as it sets up the D1 database. KV should just work without initialization, but D1 needs the schema to be created first.

The importer runs outside the Worker and writes compact monthly summaries to
the existing KV namespace. It does not insert individual rides into D1.

1. **Download system data:**
   Download CSV files from [Lyft's Bay Wheels system data](https://www.lyft.com/bikes/bay-wheels/system-data) and place them in `utils/data/`:
   ```
   utils/data/202512-baywheels-tripdata.csv
   utils/data/202601-baywheels-tripdata.csv
   # etc.
   ```

2. **Import a month from the Bay Wheels S3 archive:**
   ```bash
   python3 utils/import-month.py 2026-02
   python3 utils/import-month.py 2017
   ```
   Use a year for a yearly archive such as 2017. Omit the period to process all
   available archives. Each CSV is reduced to monthly station stats and route
   counts, then uploaded to KV; raw ride rows are discarded. Legacy Ford GoBike
   columns are normalized automatically.

3. **Backfill compact summaries for months already in D1:**
   ```bash
   pnpm cache:month-stats
   ```
   Pass a month such as `2026-02` to refresh only that month. The no-argument
   command discovers each existing `rides_YYYYMM` table in remote D1 and writes
   station stats and route counts to KV.

4. **Backfill the local pair cache when needed:**
   ```bash
   python3 utils/fetch_routes.py
   ```
