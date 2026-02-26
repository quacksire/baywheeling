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

## Limitations

**Route lines** are computed using [OSRM](https://project-osrm.org), the only free open-source routing engine I could find.

It only supports `driving` and `walking` modes. I chose `driving` because walking had more issues.

If you have another free and simple option, feel free to open an issue.

## Built With

- [Next.js](https://nextjs.org) with [shadcn/ui](https://ui.shadcn.com) and [Tailwind](https://tailwindcss.com)
- [MapLibre GL](https://maplibre.org) (via [mapcn](https://developers.maptiler.com/docs/mapcn) and [carto](https://carto.com)) for mapping
- [Deck.gl](https://deck.gl) for route rendering
- [Recharts](https://recharts.org) for charts
- **[Cloudflare Workers](https://workers.cloudflare.com)** — Edge compute for OSRM routing requests and API proxying
- **[Cloudflare D1](https://developers.cloudflare.com/d1)** — SQLite database for caching computed route polylines, reducing API calls to OSRM
- **[Cloudflare KV](https://developers.cloudflare.com/kv)** — Key-value store for rapid access to station metadata and frequently-requested aggregated trip statistics
- [Cloudflare](https://cloudflare.com) via [opennext](https://opennext.js.org) for hosting
- [Deploy your own](https://github.com/samwarnick/baywheeling) or check out the code on [GitHub](https://github.com/samwarnick/baywheeling)

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

<Alert type="info">
The app relies on historical trip data from Lyft's Bay Wheels system. This data is not included in the repository due to size, but you can easily load it yourself using the steps below.
Make you run the `init` script before loading data, as it sets up the D1 database. KV should just work without initialization, but D1 needs the schema to be created first.
</Alert>

To load Bay Wheels trip data into D1:

1. **Download system data:**
   Download CSV files from [Lyft's Bay Wheels system data](https://www.lyft.com/bikes/bay-wheels/system-data) and place them in `utils/data/`:
   ```
   utils/data/202512-baywheels-tripdata.csv
   utils/data/202601-baywheels-tripdata.csv
   # etc.
   ```

2. **Convert CSV to SQL:**
   ```bash
   python utils/csv_to_d1_sql.py utils/data
   ```
   This generates SQL insert statements from the CSV files.

3. **Upload to D1:**
   ```bash
   ./utils/load-seeds.sh
   ```
   This loads the generated SQL into your Cloudflare D1 database.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
